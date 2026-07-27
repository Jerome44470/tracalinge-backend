import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, getSetting, setSetting } from "../db.js";
import { requireStaff } from "../auth.js";
import { broadcastStaff, broadcastClient } from "../realtime.js";

export const invoicesRouter = Router();
invoicesRouter.use(requireStaff);

function nextNumero() {
  const n = parseInt(getSetting("invCounter", "1"), 10);
  setSetting("invCounter", n + 1);
  return `FA-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
}

function noteTotal(noteId) {
  const items = db.prepare(`
    SELECT dni.type_id, lt.price FROM delivery_note_items dni
    JOIN linen_types lt ON lt.id = dni.type_id WHERE dni.delivery_note_id = ?`).all(noteId);
  return items.reduce((s, i) => s + i.price, 0);
}

invoicesRouter.get("/", (req, res) => {
  const { clientId } = req.query;
  const sql = clientId ? "SELECT * FROM invoices WHERE client_id = ? ORDER BY created_at DESC" : "SELECT * FROM invoices ORDER BY created_at DESC";
  const invoices = clientId ? db.prepare(sql).all(clientId) : db.prepare(sql).all();
  res.json(invoices.map(withNotes));
});

function withNotes(inv) {
  const noteIds = db.prepare("SELECT delivery_note_id FROM invoice_notes WHERE invoice_id = ?").all(inv.id).map((r) => r.delivery_note_id);
  return { ...inv, deliveryNoteIds: noteIds };
}

/**
 * POST /api/invoices
 * body: { clientId, deliveryNoteIds: [...], periodType: 'ponctuelle'|'quinzaine'|'mois' }
 * Cumule les bons sélectionnés (déjà envoyés, pas encore facturés) en une facture.
 */
invoicesRouter.post("/", (req, res) => {
  const { clientId, deliveryNoteIds, periodType } = req.body || {};
  if (!clientId || !Array.isArray(deliveryNoteIds) || deliveryNoteIds.length === 0) {
    return res.status(400).json({ error: "clientId et deliveryNoteIds[] requis." });
  }
  const notes = deliveryNoteIds.map((id) => db.prepare("SELECT * FROM delivery_notes WHERE id = ?").get(id));
  const badIndex = notes.findIndex((n) => !n || n.client_id !== clientId || n.status !== "envoye" || n.invoiced);
  if (badIndex !== -1) return res.status(409).json({ error: "Un des bons sélectionnés n'est plus éligible (non envoyé, déjà facturé, ou autre client)." });

  const total = notes.reduce((s, n) => s + noteTotal(n.id), 0);
  const id = randomUUID();
  const numero = nextNumero();
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO invoices (id, numero, client_id, period_type, total_ht, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, numero, clientId, periodType || "ponctuelle", total, now);
    for (const n of notes) {
      db.prepare("INSERT INTO invoice_notes (invoice_id, delivery_note_id) VALUES (?,?)").run(id, n.id);
      db.prepare("UPDATE delivery_notes SET invoiced=1, invoice_id=? WHERE id=?").run(id, n.id);
    }
  });
  tx();

  const invoice = withNotes(db.prepare("SELECT * FROM invoices WHERE id = ?").get(id));
  broadcastStaff("invoice:created", invoice);
  broadcastClient(clientId, "invoice:created", invoice);
  res.status(201).json(invoice);
});

invoicesRouter.get("/:id", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Facture introuvable." });
  res.json(withNotes(invoice));
});

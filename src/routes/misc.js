import { Router } from "express";
import { db, getSetting, setSetting } from "../db.js";
import { requireStaff, requireClient } from "../auth.js";

export const itemsRouter = Router();
itemsRouter.use(requireStaff);

itemsRouter.get("/", (req, res) => {
  const { status, clientId } = req.query;
  let sql = "SELECT * FROM items";
  const params = [];
  const clauses = [];
  if (status) { clauses.push("status = ?"); params.push(status); }
  if (clientId) { clauses.push("client_id = ?"); params.push(clientId); }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  res.json(db.prepare(sql).all(...params));
});

// Linge reçu depuis plus de N jours sans être reparti — alimente l'onglet "Linge perdu".
itemsRouter.get("/overdue", (req, res) => {
  const days = parseInt(req.query.days || getSetting("thresholdDays", "5"), 10);
  const cutoff = Date.now() - days * 86400000;
  const rows = db.prepare("SELECT * FROM items WHERE status='recu' AND received_at < ?").all(cutoff);
  res.json(rows);
});

itemsRouter.post("/:tag/declare-lost", (req, res) => {
  const result = db.prepare("UPDATE items SET status='perdu' WHERE tag=? AND status='recu'").run(req.params.tag);
  if (result.changes === 0) return res.status(409).json({ error: "Article introuvable ou déjà traité." });
  res.json({ ok: true });
});

export const settingsRouter = Router();
settingsRouter.use(requireStaff);

const SETTINGS_KEYS = [
  "thresholdDays", "companyName", "legalForm", "capitalSocial", "companyAddress", "companyEmail",
  "siret", "tvaIntra", "rcs", "paymentTermsDays", "tvaRate",
];

settingsRouter.get("/", (req, res) => {
  const out = {};
  for (const k of SETTINGS_KEYS) out[k] = getSetting(k, "");
  res.json(out);
});

settingsRouter.patch("/", (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (SETTINGS_KEYS.includes(k)) setSetting(k, v);
  }
  const out = {};
  for (const k of SETTINGS_KEYS) out[k] = getSetting(k, "");
  res.json(out);
});

// Espace client : lecture seule, strictement limité aux données du client authentifié.
export const portalRouter = Router();
portalRouter.use(requireClient);

portalRouter.get("/delivery-notes", (req, res) => {
  const notes = db.prepare("SELECT * FROM delivery_notes WHERE client_id = ? AND status='envoye' ORDER BY created_at DESC").all(req.client.sub);
  res.json(notes.map((n) => ({ ...n, items: db.prepare("SELECT tag, type_id FROM delivery_note_items WHERE delivery_note_id=?").all(n.id) })));
});

portalRouter.get("/invoices", (req, res) => {
  const invoices = db.prepare("SELECT * FROM invoices WHERE client_id = ? ORDER BY created_at DESC").all(req.client.sub);
  res.json(invoices.map((inv) => ({ ...inv, deliveryNoteIds: db.prepare("SELECT delivery_note_id FROM invoice_notes WHERE invoice_id=?").all(inv.id).map((r) => r.delivery_note_id) })));
});

// Les tarifs et les mentions légales figurent de toute façon sur les documents PDF envoyés au
// client : les exposer en lecture seule à l'espace client authentifié ne révèle rien de nouveau.
portalRouter.get("/linen-types", (req, res) => {
  res.json(db.prepare("SELECT * FROM linen_types ORDER BY name").all());
});
portalRouter.get("/settings", (req, res) => {
  const out = {};
  for (const k of SETTINGS_KEYS) out[k] = getSetting(k, "");
  res.json(out);
});

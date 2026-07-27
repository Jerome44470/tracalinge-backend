import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, getSetting, setSetting } from "../db.js";
import { requireStaff } from "../auth.js";
import { broadcastStaff, broadcastClient } from "../realtime.js";

export const deliveryNotesRouter = Router();
deliveryNotesRouter.use(requireStaff);

function nextNumero() {
  const n = parseInt(getSetting("dlnCounter", "1"), 10);
  setSetting("dlnCounter", n + 1);
  return `BL-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
}

function loadNote(id) {
  const note = db.prepare("SELECT * FROM delivery_notes WHERE id = ?").get(id);
  if (!note) return null;
  const items = db.prepare("SELECT tag, type_id FROM delivery_note_items WHERE delivery_note_id = ?").all(id);
  return { ...note, items };
}

deliveryNotesRouter.get("/", (req, res) => {
  const { clientId, status } = req.query;
  let sql = "SELECT * FROM delivery_notes";
  const params = [];
  const clauses = [];
  if (clientId) { clauses.push("client_id = ?"); params.push(clientId); }
  if (status) { clauses.push("status = ?"); params.push(status); }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY created_at DESC";
  const notes = db.prepare(sql).all(...params);
  res.json(notes.map((n) => loadNote(n.id)));
});

/**
 * POST /api/delivery-notes
 * body: { clientId, tags: ["RFID-...", ...] }
 * Appelé une fois à la validation du lot d'expédition (après plusieurs scans côté terminal).
 * Vérifie server-side que chaque tag est bien "recu" pour ce client avant de créer le bon —
 * ceinture-bretelles même si le terminal a déjà fait le contrôle via /scan/check.
 */
deliveryNotesRouter.post("/", (req, res) => {
  const { clientId, tags } = req.body || {};
  if (!clientId || !Array.isArray(tags) || tags.length === 0) return res.status(400).json({ error: "clientId et tags[] requis." });

  const normalized = [...new Set(tags.map((t) => String(t).trim().toUpperCase()))]; // dédoublonnage défensif
  const items = normalized.map((tag) => db.prepare("SELECT * FROM items WHERE tag = ?").get(tag));
  const badIndex = items.findIndex((it) => !it || it.client_id !== clientId || it.status !== "recu");
  if (badIndex !== -1) {
    return res.status(409).json({ error: `Tag ${normalized[badIndex]} invalide pour ce bon (introuvable, autre client, ou déjà traité).` });
  }

  const now = Date.now();
  const id = randomUUID();
  const numero = nextNumero();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO delivery_notes (id, numero, client_id, created_at, status) VALUES (?,?,?,?,'brouillon')").run(id, numero, clientId, now);
    for (const it of items) {
      db.prepare("INSERT INTO delivery_note_items (delivery_note_id, tag, type_id) VALUES (?,?,?)").run(id, it.tag, it.type_id);
      db.prepare("UPDATE items SET status='expedie', shipped_at=?, delivery_note_id=? WHERE tag=?").run(now, id, it.tag);
      db.prepare("INSERT INTO movements (id, tag, client_id, type_id, kind, source, device_label, at) VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), it.tag, clientId, it.type_id, "expedition", "quai", req.user?.email || "staff", now);
    }
  });
  tx();

  const note = loadNote(id);
  broadcastStaff("deliveryNote:created", note);
  res.status(201).json(note);
});

deliveryNotesRouter.post("/:id/send", (req, res) => {
  const note = loadNote(req.params.id);
  if (!note) return res.status(404).json({ error: "Bon introuvable." });
  const now = Date.now();
  db.prepare("UPDATE delivery_notes SET status='envoye', sent_at=? WHERE id=?").run(now, note.id);
  // Point d'intégration : brancher ici un service d'emailing (ex. SendGrid, Brevo) pour joindre
  // le PDF et l'envoyer réellement au client. Pour l'instant l'envoi est marqué mais pas exécuté.
  const updated = loadNote(note.id);
  broadcastStaff("deliveryNote:updated", updated);
  broadcastClient(note.client_id, "deliveryNote:updated", updated);
  res.json(updated);
});

// Retire une ligne d'un bon en brouillon (erreur de scan) : l'article repasse "en lavage".
deliveryNotesRouter.patch("/:id/remove-item", (req, res) => {
  const { tag } = req.body || {};
  const note = loadNote(req.params.id);
  if (!note) return res.status(404).json({ error: "Bon introuvable." });
  if (note.status !== "brouillon") return res.status(409).json({ error: "Seuls les bons en brouillon sont modifiables." });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM delivery_note_items WHERE delivery_note_id = ? AND tag = ?").run(note.id, tag);
    db.prepare("UPDATE items SET status='recu', shipped_at=NULL, delivery_note_id=NULL WHERE tag=?").run(tag);
    const remaining = db.prepare("SELECT COUNT(*) c FROM delivery_note_items WHERE delivery_note_id = ?").get(note.id).c;
    if (remaining === 0) db.prepare("DELETE FROM delivery_notes WHERE id = ?").run(note.id);
  });
  tx();

  broadcastStaff("deliveryNote:updated", loadNote(note.id) || { id: note.id, deleted: true });
  res.json(loadNote(note.id) || { deleted: true });
});

deliveryNotesRouter.delete("/:id", (req, res) => {
  const note = loadNote(req.params.id);
  if (!note) return res.status(404).json({ error: "Bon introuvable." });
  if (note.status !== "brouillon") return res.status(409).json({ error: "Seuls les bons en brouillon sont supprimables." });

  const tx = db.transaction(() => {
    for (const it of note.items) db.prepare("UPDATE items SET status='recu', shipped_at=NULL, delivery_note_id=NULL WHERE tag=?").run(it.tag);
    db.prepare("DELETE FROM delivery_note_items WHERE delivery_note_id = ?").run(note.id);
    db.prepare("DELETE FROM delivery_notes WHERE id = ?").run(note.id);
  });
  tx();

  broadcastStaff("deliveryNote:deleted", { id: note.id });
  res.json({ deleted: true });
});

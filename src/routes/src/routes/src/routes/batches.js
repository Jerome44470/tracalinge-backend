import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, nextDeliveryNumero } from "../db.js";
import { requireStaff } from "../auth.js";
import { broadcastStaff, broadcastClient } from "../realtime.js";

export const batchesRouter = Router();
batchesRouter.use(requireStaff);

function loadBatch(id) {
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(id);
  if (!batch) return null;
  const items = db.prepare("SELECT type_id, quantity FROM batch_items WHERE batch_id = ?").all(id);
  const orderItems = batch.order_id ? db.prepare("SELECT type_id, quantity FROM order_items WHERE order_id = ?").all(batch.order_id) : [];
  return { ...batch, items, orderItems };
}

function genManualTag() {
  return "MANUEL-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

batchesRouter.get("/", (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare("SELECT id FROM batches WHERE status = ? ORDER BY created_at DESC").all(status)
    : db.prepare("SELECT id FROM batches ORDER BY created_at DESC").all();
  res.json(rows.map((r) => loadBatch(r.id)));
});

batchesRouter.get("/:id", (req, res) => {
  const batch = loadBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: "Lot introuvable." });
  res.json(batch);
});

batchesRouter.post("/", (req, res) => {
  const { clientId } = req.body || {};
  if (!clientId) return res.status(400).json({ error: "clientId requis." });
  const id = randomUUID();
  db.prepare("INSERT INTO batches (id, client_id, order_id, status, created_at) VALUES (?,?,NULL,'traitement',?)").run(id, clientId, Date.now());
  res.status(201).json(loadBatch(id));
});

batchesRouter.patch("/:id/steps", (req, res) => {
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(req.params.id);
  if (!batch) return res.status(404).json({ error: "Lot introuvable." });
  const fields = ["step_tri", "step_lavage", "step_sechage", "step_pliage", "step_calandre"];
  const next = {};
  for (const f of fields) next[f] = req.body[f] !== undefined ? (req.body[f] ? 1 : 0) : batch[f];

  const eligible = next.step_tri && next.step_lavage && (next.step_pliage || next.step_calandre);
  const nextStatus = eligible && batch.status === "traitement" ? "a_preparer" : batch.status === "a_preparer" && !eligible ? "traitement" : batch.status;

  db.prepare(`UPDATE batches SET step_tri=?, step_lavage=?, step_sechage=?, step_pliage=?, step_calandre=?, status=? WHERE id=?`)
    .run(next.step_tri, next.step_lavage, next.step_sechage, next.step_pliage, next.step_calandre, nextStatus, batch.id);

  const updated = loadBatch(batch.id);
  broadcastStaff("batch:updated", updated);
  res.json(updated);
});

batchesRouter.post("/:id/prepare", (req, res) => {
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(req.params.id);
  if (!batch) return res.status(404).json({ error: "Lot introuvable." });
  if (batch.status !== "a_preparer" && batch.status !== "a_valider") {
    return res.status(409).json({ error: "Ce lot n'est pas encore prêt à être préparé (tri, lavage et pliage/calandre requis)." });
  }
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).filter((i) => i.typeId && Number(i.quantity) > 0);
  if (items.length === 0) return res.status(400).json({ error: "Renseignez au moins un article avec une quantité." });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM batch_items WHERE batch_id = ?").run(batch.id);
    for (const it of items) {
      db.prepare("INSERT INTO batch_items (batch_id, type_id, quantity) VALUES (?,?,?)").run(batch.id, it.typeId, Math.round(Number(it.quantity)));
    }
    db.prepare("UPDATE batches SET status='a_valider', prepared_at=? WHERE id=?").run(Date.now(), batch.id);
  });
  tx();

  const updated = loadBatch(batch.id);
  broadcastStaff("batch:updated", updated);
  res.json(updated);
});

batchesRouter.post("/:id/validate", (req, res) => {
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(req.params.id);
  if (!batch) return res.status(404).json({ error: "Lot introuvable." });
  if (batch.status !== "a_valider") return res.status(409).json({ error: "Ce lot n'est pas prêt à être validé." });
  const items = db.prepare("SELECT type_id, quantity FROM batch_items WHERE batch_id = ?").all(batch.id);
  if (items.length === 0) return res.status(409).json({ error: "Aucun article préparé pour ce lot." });

  const now = Date.now();
  const noteId = randomUUID();
  const numero = nextDeliveryNumero();

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO delivery_notes (id, numero, client_id, created_at, status) VALUES (?,?,?,?,'brouillon')").run(noteId, numero, batch.client_id, now);
    for (const it of items) {
      for (let i = 0; i < it.quantity; i++) {
        const tag = genManualTag();
        db.prepare(`INSERT INTO items (tag, client_id, type_id, status, received_at, shipped_at, delivery_note_id, invoiced) VALUES (?,?,?,'expedie',?,?,?,0)`)
          .run(tag, batch.client_id, it.type_id, now, now, noteId);
        db.prepare("INSERT INTO delivery_note_items (delivery_note_id, tag, type_id) VALUES (?,?,?)").run(noteId, tag, it.type_id);
        db.prepare("INSERT INTO movements (id, tag, client_id, type_id, kind, source, device_label, at) VALUES (?,?,?,?,?,?,?,?)")
          .run(randomUUID(), tag, batch.client_id, it.type_id, "reception", "manuel", req.user?.email || "staff", now);
        db.prepare("INSERT INTO movements (id, tag, client_id, type_id, kind, source, device_label, at) VALUES (?,?,?,?,?,?,?,?)")
          .run(randomUUID(), tag, batch.client_id, it.type_id, "expedition", "manuel", req.user?.email || "staff", now);
      }
    }
    db.prepare("UPDATE batches SET status='validee', validated_at=?, delivery_note_id=? WHERE id=?").run(now, noteId, batch.id);
    if (batch.order_id) db.prepare("UPDATE orders SET status='terminee' WHERE id=?").run(batch.order_id);
  });
  tx();

  broadcastStaff("deliveryNote:created", { id: noteId, numero });
  broadcastStaff("batch:updated", loadBatch(batch.id));
  res.json({ deliveryNoteId: noteId, numero });
});

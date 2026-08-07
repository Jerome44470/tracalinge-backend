import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireStaff, requireClient } from "../auth.js";

function loadOrder(id) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) return null;
  const items = db.prepare("SELECT type_id, quantity FROM order_items WHERE order_id = ?").all(id);
  return { ...order, items };
}

export const ordersPortalRouter = Router();
ordersPortalRouter.use(requireClient);

ordersPortalRouter.get("/catalog", (req, res) => {
  const types = db.prepare("SELECT * FROM linen_types WHERE active = 1 ORDER BY sort_order ASC, name ASC").all();
  const overrides = db.prepare("SELECT * FROM client_linen_types WHERE client_id = ?").all(req.client.sub);
  const byType = Object.fromEntries(overrides.map((o) => [o.type_id, o]));
  const rows = types
    .map((t) => {
      const o = byType[t.id];
      return { typeId: t.id, name: t.name, price: o ? o.price : t.price, included: o ? !!o.included : true };
    })
    .filter((r) => r.included);
  res.json(rows);
});

ordersPortalRouter.post("/", (req, res) => {
  const { items, notes } = req.body || {};
  const clean = (Array.isArray(items) ? items : []).filter((i) => i.typeId && Number(i.quantity) > 0);
  if (clean.length === 0) return res.status(400).json({ error: "Ajoutez au moins un article avec une quantité." });
  const id = randomUUID();
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO orders (id, client_id, status, notes, created_at) VALUES (?,?,?,?,?)").run(id, req.client.sub, "attente", notes || "", now);
    for (const it of clean) {
      db.prepare("INSERT INTO order_items (order_id, type_id, quantity) VALUES (?,?,?)").run(id, it.typeId, Math.round(Number(it.quantity)));
    }
  });
  tx();
  res.status(201).json(loadOrder(id));
});

ordersPortalRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT id FROM orders WHERE client_id = ? ORDER BY created_at DESC").all(req.client.sub);
  res.json(rows.map((r) => loadOrder(r.id)));
});

export const ordersStaffRouter = Router();
ordersStaffRouter.use(requireStaff);

ordersStaffRouter.get("/", (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare("SELECT id FROM orders WHERE status = ? ORDER BY created_at DESC").all(status)
    : db.prepare("SELECT id FROM orders ORDER BY created_at DESC").all();
  res.json(rows.map((r) => loadOrder(r.id)));
});

ordersStaffRouter.post("/:id/start", (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Commande introuvable." });
  if (order.status !== "attente") return res.status(409).json({ error: "Cette commande a déjà été prise en traitement." });
  const batchId = randomUUID();
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO batches (id, client_id, order_id, status, created_at) VALUES (?,?,?,'traitement',?)").run(batchId, order.client_id, order.id, now);
    db.prepare("UPDATE orders SET status='en_traitement' WHERE id=?").run(order.id);
  });
  tx();
  res.status(201).json({ batchId });
});

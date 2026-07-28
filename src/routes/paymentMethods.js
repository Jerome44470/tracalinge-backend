import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireStaff } from "../auth.js";

export const paymentMethodsRouter = Router();
paymentMethodsRouter.use(requireStaff);

paymentMethodsRouter.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM payment_methods ORDER BY sort_order ASC, name ASC").all());
});

paymentMethodsRouter.post("/", (req, res) => {
  const { name, defaultDays } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Le nom du mode de règlement est requis." });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) m FROM payment_methods").get().m;
  const id = randomUUID();
  db.prepare("INSERT INTO payment_methods (id, name, default_days, sort_order) VALUES (?,?,?,?)")
    .run(id, name.trim(), Number(defaultDays) || 30, maxOrder + 1);
  res.status(201).json(db.prepare("SELECT * FROM payment_methods WHERE id = ?").get(id));
});

paymentMethodsRouter.patch("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM payment_methods WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Mode de règlement introuvable." });
  const { name, defaultDays } = req.body || {};
  const nextName = name !== undefined ? String(name).trim() : existing.name;
  const nextDays = defaultDays !== undefined ? Number(defaultDays) : existing.default_days;
  if (!nextName) return res.status(400).json({ error: "Le nom est requis." });
  db.prepare("UPDATE payment_methods SET name = ?, default_days = ? WHERE id = ?").run(nextName, nextDays, existing.id);
  res.json(db.prepare("SELECT * FROM payment_methods WHERE id = ?").get(existing.id));
});

paymentMethodsRouter.delete("/:id", (req, res) => {
  const used = db.prepare("SELECT COUNT(*) c FROM clients WHERE payment_method_id = ?").get(req.params.id).c;
  if (used > 0) return res.status(409).json({ error: "Ce mode de règlement est utilisé par au moins un client — réaffectez-le avant de supprimer." });
  db.prepare("DELETE FROM payment_methods WHERE id = ?").run(req.params.id);
  res.json({ deleted: true });
});

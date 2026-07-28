import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireStaff } from "../auth.js";
import { createClient } from "./clients.js";

export const prospectsPublicRouter = Router();

prospectsPublicRouter.get("/:token", (req, res) => {
  const prospect = db.prepare("SELECT * FROM prospects WHERE token = ?").get(req.params.token);
  if (!prospect) return res.status(404).json({ error: "Lien invalide ou expiré." });
  res.json({
    status: prospect.status,
    data: prospect.data ? JSON.parse(prospect.data) : null,
    categories: db.prepare("SELECT * FROM client_categories ORDER BY sort_order ASC, name ASC").all(),
    paymentMethods: db.prepare("SELECT * FROM payment_methods ORDER BY sort_order ASC, name ASC").all(),
  });
});

prospectsPublicRouter.post("/:token", (req, res) => {
  const prospect = db.prepare("SELECT * FROM prospects WHERE token = ?").get(req.params.token);
  if (!prospect) return res.status(404).json({ error: "Lien invalide ou expiré." });
  if (prospect.status !== "pending") return res.status(409).json({ error: "Ce formulaire a déjà été soumis." });
  db.prepare("UPDATE prospects SET status='submitted', data=?, submitted_at=? WHERE id=?")
    .run(JSON.stringify(req.body || {}), Date.now(), prospect.id);
  res.json({ ok: true });
});

export const prospectsStaffRouter = Router();
prospectsStaffRouter.use(requireStaff);

prospectsStaffRouter.post("/invite", (req, res) => {
  const id = randomUUID();
  const token = randomUUID();
  db.prepare("INSERT INTO prospects (id, token, status, created_at) VALUES (?,?,?,?)").run(id, token, "pending", Date.now());
  const base = process.env.PORTAL_URL || "";
  res.status(201).json({ id, token, url: `${base}/prospect/${token}` });
});

prospectsStaffRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM prospects ORDER BY created_at DESC").all();
  res.json(rows.map((p) => ({ ...p, data: p.data ? JSON.parse(p.data) : null })));
});

prospectsStaffRouter.post("/:id/approve", (req, res) => {
  const prospect = db.prepare("SELECT * FROM prospects WHERE id = ?").get(req.params.id);
  if (!prospect) return res.status(404).json({ error: "Prospect introuvable." });
  if (prospect.status !== "submitted") return res.status(409).json({ error: "Ce prospect n'a pas encore soumis son formulaire." });
  try {
    const { client, temporaryPassword } = createClient(JSON.parse(prospect.data || "{}"));
    db.prepare("UPDATE prospects SET status='approved', client_id=? WHERE id=?").run(client.id, prospect.id);
    res.json({ client, temporaryPassword });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

prospectsStaffRouter.post("/:id/reject", (req, res) => {
  const result = db.prepare("UPDATE prospects SET status='rejected' WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Prospect introuvable." });
  res.json({ ok: true });
});

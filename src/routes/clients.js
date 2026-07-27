import { Router } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../db.js";
import { requireStaff, hashPassword } from "../auth.js";

export const clientsRouter = Router();
clientsRouter.use(requireStaff);

clientsRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT id, name, address, email, created_at FROM clients ORDER BY name").all();
  res.json(rows);
});

clientsRouter.post("/", (req, res) => {
  const { name, address, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: "Nom et email requis." });
  const id = randomUUID();
  const password = randomBytes(5).toString("hex");
  db.prepare("INSERT INTO clients (id, name, address, email, password_hash, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, name, address || "", email.toLowerCase().trim(), hashPassword(password), Date.now());
  res.status(201).json({ id, name, address, email, temporaryPassword: password });
});

// Régénère le mot de passe de l'espace client (à communiquer au client par un canal sûr).
clientsRouter.post("/:id/reset-password", (req, res) => {
  const password = randomBytes(5).toString("hex");
  const result = db.prepare("UPDATE clients SET password_hash = ? WHERE id = ?").run(hashPassword(password), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Client introuvable." });
  res.json({ temporaryPassword: password });
});

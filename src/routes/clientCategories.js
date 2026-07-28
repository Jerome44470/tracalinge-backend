import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireStaff } from "../auth.js";

export const clientCategoriesRouter = Router();
clientCategoriesRouter.use(requireStaff);

clientCategoriesRouter.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM client_categories ORDER BY sort_order ASC, name ASC").all());
});

clientCategoriesRouter.post("/", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Le nom de la catégorie est requis." });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) m FROM client_categories").get().m;
  const id = randomUUID();
  db.prepare("INSERT INTO client_categories (id, name, sort_order) VALUES (?,?,?)").run(id, name.trim(), maxOrder + 1);
  res.status(201).json(db.prepare("SELECT * FROM client_categories WHERE id = ?").get(id));
});

clientCategoriesRouter.patch("/:id", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Le nom de la catégorie est requis." });
  const result = db.prepare("UPDATE client_categories SET name = ? WHERE id = ?").run(name.trim(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Catégorie introuvable." });
  res.json(db.prepare("SELECT * FROM client_categories WHERE id = ?").get(req.params.id));
});

clientCategoriesRouter.delete("/:id", (req, res) => {
  const used = db.prepare("SELECT COUNT(*) c FROM clients WHERE category_id = ?").get(req.params.id).c;
  if (used > 0) return res.status(409).json({ error: "Cette catégorie est utilisée par au moins un client — réaffectez-le avant de supprimer." });
  db.prepare("DELETE FROM client_categories WHERE id = ?").run(req.params.id);
  res.json({ deleted: true });
});

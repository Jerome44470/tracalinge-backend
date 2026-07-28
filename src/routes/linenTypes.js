import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireStaff, requireAdmin } from "../auth.js";

export const linenTypesRouter = Router();
linenTypesRouter.use(requireStaff);

linenTypesRouter.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM linen_types ORDER BY sort_order ASC, name ASC").all());
});

linenTypesRouter.post("/", (req, res) => {
  const { name, price } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Le nom de l'article est requis." });
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) return res.status(400).json({ error: "Le prix doit être un nombre positif." });

  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) m FROM linen_types").get().m;
  const id = randomUUID();
  db.prepare("INSERT INTO linen_types (id, name, price, active, sort_order) VALUES (?,?,?,1,?)")
    .run(id, name.trim(), numericPrice, maxOrder + 1);
  res.status(201).json(db.prepare("SELECT * FROM linen_types WHERE id = ?").get(id));
});

linenTypesRouter.patch("/:id", (req, res) => {
  const type = db.prepare("SELECT * FROM linen_types WHERE id = ?").get(req.params.id);
  if (!type) return res.status(404).json({ error: "Article introuvable." });

  const { name, price, active } = req.body || {};

  if (active === true && type.active === 0 && req.user?.staffRole !== "admin") {
    return res.status(403).json({ error: "Seul un administrateur peut réactiver un article." });
  }

  const nextName = name !== undefined ? String(name).trim() : type.name;
  const nextPrice = price !== undefined ? Number(price) : type.price;
  if (!nextName) return res.status(400).json({ error: "Le nom de l'article est requis." });
  if (!Number.isFinite(nextPrice) || nextPrice < 0) return res.status(400).json({ error: "Le prix doit être un nombre positif." });
  const nextActive = active !== undefined ? (active ? 1 : 0) : type.active;

  db.prepare("UPDATE linen_types SET name=?, price=?, active=? WHERE id=?").run(nextName, nextPrice, nextActive, type.id);
  res.json(db.prepare("SELECT * FROM linen_types WHERE id = ?").get(type.id));
});

linenTypesRouter.patch("/reorder", (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return res.status(400).json({ error: "orderedIds[] requis." });
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      db.prepare("UPDATE linen_types SET sort_order = ? WHERE id = ?").run(index + 1, id);
    });
  });
  tx();
  res.json(db.prepare("SELECT * FROM linen_types ORDER BY sort_order ASC, name ASC").all());
});

linenTypesRouter.delete("/:id", (req, res) => {
  const type = db.prepare("SELECT * FROM linen_types WHERE id = ?").get(req.params.id);
  if (!type) return res.status(404).json({ error: "Article introuvable." });

  const used =
    db.prepare("SELECT COUNT(*) c FROM items WHERE type_id = ?").get(type.id).c +
    db.prepare("SELECT COUNT(*) c FROM delivery_note_items WHERE type_id = ?").get(type.id).c +
    db.prepare("SELECT COUNT(*) c FROM movements WHERE type_id = ?").get(type.id).c;

  if (used > 0) {
    return res.status(409).json({ error: "Cet article a déjà été utilisé (linge, bons ou mouvements liés) : désactivez-le plutôt que de le supprimer, pour conserver l'historique." });
  }

  db.prepare("DELETE FROM linen_types WHERE id = ?").run(type.id);
  res.json({ deleted: true });
});

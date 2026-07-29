import { Router } from "express";
import { db } from "../db.js";
import { requireStaff } from "../auth.js";

export const clientLinenTypesRouter = Router({ mergeParams: true });
clientLinenTypesRouter.use(requireStaff);

clientLinenTypesRouter.get("/", (req, res) => {
  const types = db.prepare("SELECT * FROM linen_types WHERE active = 1 ORDER BY sort_order ASC, name ASC").all();
  const overrides = db.prepare("SELECT * FROM client_linen_types WHERE client_id = ?").all(req.params.clientId);
  const byType = Object.fromEntries(overrides.map((o) => [o.type_id, o]));
  res.json(types.map((t) => {
    const o = byType[t.id];
    return { typeId: t.id, name: t.name, basePrice: t.price, price: o ? o.price : t.price, included: o ? !!o.included : true, customized: !!o };
  }));
});

clientLinenTypesRouter.put("/:typeId", (req, res) => {
  const { price, included } = req.body || {};
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) return res.status(400).json({ error: "Le prix doit être un nombre positif." });
  db.prepare(`
    INSERT INTO client_linen_types (client_id, type_id, price, included) VALUES (?,?,?,?)
    ON CONFLICT(client_id, type_id) DO UPDATE SET price = excluded.price, included = excluded.included
  `).run(req.params.clientId, req.params.typeId, numericPrice, included === false ? 0 : 1);
  res.json({ ok: true });
});

clientLinenTypesRouter.delete("/:typeId", (req, res) => {
  db.prepare("DELETE FROM client_linen_types WHERE client_id = ? AND type_id = ?").run(req.params.clientId, req.params.typeId);
  res.json({ ok: true });
});

clientLinenTypesRouter.post("/bulk-increase", (req, res) => {
  const percent = Number((req.body || {}).percent);
  if (!Number.isFinite(percent)) return res.status(400).json({ error: "Pourcentage invalide." });
  const types = db.prepare("SELECT * FROM linen_types WHERE active = 1").all();
  const tx = db.transaction(() => {
    for (const t of types) {
      const existing = db.prepare("SELECT * FROM client_linen_types WHERE client_id = ? AND type_id = ?").get(req.params.clientId, t.id);
      const base = existing ? existing.price : t.price;
      const nextPrice = Math.round(base * (1 + percent / 100) * 100) / 100;
      db.prepare(`
        INSERT INTO client_linen_types (client_id, type_id, price, included) VALUES (?,?,?,1)
        ON CONFLICT(client_id, type_id) DO UPDATE SET price = excluded.price
      `).run(req.params.clientId, t.id, nextPrice);
    }
  });
  tx();
  res.json({ ok: true });
});

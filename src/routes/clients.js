import { Router } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { db, nextClientNumber } from "../db.js";
import { requireStaff, hashPassword } from "../auth.js";

export const clientsRouter = Router();
clientsRouter.use(requireStaff);

export function loadClient(id) {
  const client = db.prepare("SELECT id, name, client_number, category_id, address, billing_address, email, siret, referent_name, referent_phone, referent_email, accounting_name, accounting_phone, accounting_email, payment_method_id, payment_days, rib, bl_show_prices, created_at FROM clients WHERE id = ?").get(id);
  if (!client) return null;
  const emails = db.prepare("SELECT id, email, is_contact, is_bl, is_facture FROM client_emails WHERE client_id = ?").all(id);
  return { ...client, emails };
}

export function createClient(fields) {
  const { name, email, address, billingAddress, categoryId, siret,
    referentName, referentPhone, referentEmail, accountingName, accountingPhone, accountingEmail,
    paymentMethodId, paymentDays, rib, blShowPrices, emails } = fields;

  if (!name || !email) throw Object.assign(new Error("Nom et email requis."), { status: 400 });

  const id = randomUUID();
  const clientNumber = nextClientNumber();
  const password = randomBytes(5).toString("hex");

  db.prepare(`
    INSERT INTO clients (
      id, name, client_number, category_id, address, billing_address, email, password_hash, siret,
      referent_name, referent_phone, referent_email, accounting_name, accounting_phone, accounting_email,
      payment_method_id, payment_days, rib, bl_show_prices, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, name, clientNumber, categoryId || null, address || "", billingAddress || address || "",
    email.toLowerCase().trim(), hashPassword(password), siret || "",
    referentName || "", referentPhone || "", referentEmail || "",
    accountingName || "", accountingPhone || "", accountingEmail || "",
    paymentMethodId || null, paymentDays != null ? Number(paymentDays) : null, rib || "",
    blShowPrices === false ? 0 : 1, Date.now()
  );

  if (Array.isArray(emails)) {
    for (const e of emails) {
      if (!e.email) continue;
      db.prepare("INSERT INTO client_emails (id, client_id, email, is_contact, is_bl, is_facture) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), id, e.email.trim(), e.isContact ? 1 : 0, e.isBl ? 1 : 0, e.isFacture ? 1 : 0);
    }
  }

  return { client: loadClient(id), temporaryPassword: password };
}

clientsRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT id FROM clients ORDER BY name").all();
  res.json(rows.map((r) => loadClient(r.id)));
});

clientsRouter.get("/:id", (req, res) => {
  const client = loadClient(req.params.id);
  if (!client) return res.status(404).json({ error: "Client introuvable." });
  res.json(client);
});

clientsRouter.post("/", (req, res) => {
  try {
    const { client, temporaryPassword } = createClient(req.body || {});
    res.status(201).json({ ...client, temporaryPassword });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

clientsRouter.patch("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Client introuvable." });
  const f = req.body || {};

  const fields = {
    name: f.name !== undefined ? f.name : existing.name,
    category_id: f.categoryId !== undefined ? f.categoryId : existing.category_id,
    address: f.address !== undefined ? f.address : existing.address,
    billing_address: f.billingAddress !== undefined ? f.billingAddress : existing.billing_address,
    siret: f.siret !== undefined ? f.siret : existing.siret,
    referent_name: f.referentName !== undefined ? f.referentName : existing.referent_name,
    referent_phone: f.referentPhone !== undefined ? f.referentPhone : existing.referent_phone,
    referent_email: f.referentEmail !== undefined ? f.referentEmail : existing.referent_email,
    accounting_name: f.accountingName !== undefined ? f.accountingName : existing.accounting_name,
    accounting_phone: f.accountingPhone !== undefined ? f.accountingPhone : existing.accounting_phone,
    accounting_email: f.accountingEmail !== undefined ? f.accountingEmail : existing.accounting_email,
    payment_method_id: f.paymentMethodId !== undefined ? f.paymentMethodId : existing.payment_method_id,
    payment_days: f.paymentDays !== undefined ? Number(f.paymentDays) : existing.payment_days,
    rib: f.rib !== undefined ? f.rib : existing.rib,
    bl_show_prices: f.blShowPrices !== undefined ? (f.blShowPrices ? 1 : 0) : existing.bl_show_prices,
  };

  db.prepare(`
    UPDATE clients SET name=?, category_id=?, address=?, billing_address=?, siret=?,
      referent_name=?, referent_phone=?, referent_email=?, accounting_name=?, accounting_phone=?, accounting_email=?,
      payment_method_id=?, payment_days=?, rib=?, bl_show_prices=?
    WHERE id=?
  `).run(
    fields.name, fields.category_id, fields.address, fields.billing_address, fields.siret,
    fields.referent_name, fields.referent_phone, fields.referent_email,
    fields.accounting_name, fields.accounting_phone, fields.accounting_email,
    fields.payment_method_id, fields.payment_days, fields.rib, fields.bl_show_prices,
    existing.id
  );

  if (Array.isArray(f.emails)) {
    db.prepare("DELETE FROM client_emails WHERE client_id = ?").run(existing.id);
    for (const e of f.emails) {
      if (!e.email) continue;
      db.prepare("INSERT INTO client_emails (id, client_id, email, is_contact, is_bl, is_facture) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), existing.id, e.email.trim(), e.isContact ? 1 : 0, e.isBl ? 1 : 0, e.isFacture ? 1 : 0);
    }
  }

  res.json(loadClient(existing.id));
});

clientsRouter.post("/:id/reset-password", (req, res) => {
  const password = randomBytes(5).toString("hex");
  const result = db.prepare("UPDATE clients SET password_hash = ? WHERE id = ?").run(hashPassword(password), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Client introuvable." });
  res.json({ temporaryPassword: password });
});

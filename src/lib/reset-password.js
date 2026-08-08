import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { hashPassword } from "../auth.js";

const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error("ADMIN_EMAIL et ADMIN_PASSWORD doivent être définis dans les variables Railway.");
  process.exit(1);
}

const existing = db.prepare("SELECT id FROM staff_users WHERE email = ?").get(email);
if (existing) {
  db.prepare("UPDATE staff_users SET password_hash = ?, role = 'admin' WHERE email = ?").run(hashPassword(password), email);
  console.log(`Mot de passe réinitialisé pour ${email}.`);
} else {
  db.prepare("INSERT INTO staff_users (id, email, password_hash, role, created_at) VALUES (?,?,?,?,?)")
    .run(randomUUID(), email, hashPassword(password), "admin", Date.now());
  console.log(`Compte administrateur créé pour ${email}.`);
}

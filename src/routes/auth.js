import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { signStaffToken, signClientToken, checkPassword } from "../auth.js";

export const authRouter = Router();

authRouter.post("/staff/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM staff_users WHERE email = ?").get((email || "").toLowerCase().trim());
  if (!user || !checkPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }
  res.json({ token: signStaffToken(user) });
});

authRouter.post("/portal/login", (req, res) => {
  const { email, password } = req.body || {};
  const client = db.prepare("SELECT * FROM clients WHERE email = ?").get((email || "").toLowerCase().trim());
  if (!client || !checkPassword(password || "", client.password_hash)) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }
  res.json({ token: signClientToken(client), client: { id: client.id, name: client.name } });
});

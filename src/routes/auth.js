import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { signStaffToken, signClientToken, checkPassword, requireStaff } from "../auth.js";

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
  const candidates = db.prepare("SELECT * FROM clients WHERE email = ?").all((email || "").toLowerCase().trim());
  const client = candidates.find((c) => checkPassword(password || "", c.password_hash));
  if (!client) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }
  res.json({ token: signClientToken(client), client: { id: client.id, name: client.name } });
});

authRouter.get("/me", requireStaff, (req, res) => {
  res.json({ email: req.user.email, role: req.user.staffRole || "staff" });
});

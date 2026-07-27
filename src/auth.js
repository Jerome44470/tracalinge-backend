import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) {
  console.warn("⚠️  JWT_SECRET manquant ou trop court — définissez-le dans .env avant la mise en production.");
}

export function signStaffToken(user) {
  return jwt.sign({ sub: user.id, role: "staff", email: user.email }, SECRET, { expiresIn: "12h" });
}
export function signClientToken(client) {
  return jwt.sign({ sub: client.id, role: "client", email: client.email }, SECRET, { expiresIn: "12h" });
}
export function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
export function checkPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

function verify(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

// Autorise uniquement le personnel (quai, bureau) — utilisé pour toutes les routes de gestion.
export function requireStaff(req, res, next) {
  const payload = verify(req);
  if (!payload || payload.role !== "staff") return res.status(401).json({ error: "Authentification requise (personnel)." });
  req.user = payload;
  next();
}

// Autorise uniquement un client connecté à son espace — ne peut voir que ses propres données.
export function requireClient(req, res, next) {
  const payload = verify(req);
  if (!payload || payload.role !== "client") return res.status(401).json({ error: "Authentification requise (espace client)." });
  req.client = payload;
  next();
}

// Autorise le personnel OU un appareil de collecte muni de sa clé (antenne fixe, PDA mobile,
// terminal de livraison). Ces appareils ne "se connectent" pas comme un humain : ils portent une
// clé statique envoyée dans le header X-Device-Key à chaque requête.
export function requireStaffOrDevice(req, res, next) {
  const deviceKey = req.headers["x-device-key"];
  if (deviceKey && deviceKey === process.env.DEVICE_KEY) {
    req.device = { label: req.headers["x-device-label"] || "appareil-inconnu" };
    return next();
  }
  return requireStaff(req, res, next);
}

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db, setSetting, nextClientNumber } from "../db.js";
import { hashPassword } from "../auth.js";

const LINEN_TYPES = [
  { id: "drap", name: "Drap", price: 2.5 },
  { id: "taie", name: "Taie d'oreiller", price: 0.8 },
  { id: "serviette", name: "Serviette", price: 1.2 },
  { id: "blouse", name: "Blouse", price: 3.0 },
  { id: "alese", name: "Alèse", price: 2.0 },
];

for (const t of LINEN_TYPES) {
  db.prepare("INSERT OR IGNORE INTO linen_types (id, name, price) VALUES (?,?,?)").run(t.id, t.name, t.price);
}

const adminEmail = (process.env.ADMIN_EMAIL || "admin@tracalinge.fr").toLowerCase();
const existingAdmin = db.prepare("SELECT id FROM staff_users WHERE email = ?").get(adminEmail);
if (!existingAdmin) {
  db.prepare("INSERT INTO staff_users (id, email, password_hash, role, created_at) VALUES (?,?,?,?,?)")
    .run(randomUUID(), adminEmail, hashPassword(process.env.ADMIN_PASSWORD || "change-moi"), "admin", Date.now());
  console.log(`Compte staff créé (rôle administrateur) : ${adminEmail}`);
} else {
  db.prepare("UPDATE staff_users SET role = 'admin' WHERE email = ?").run(adminEmail);
  console.log("Compte staff déjà existant — rôle administrateur confirmé.");
}

const defaults = {
  thresholdDays: "5", companyName: "Traçalinge", legalForm: "SARL", capitalSocial: "20 000 €",
  companyAddress: "1 Avenue de la Baudinière, 44470 Thouaré-sur-Loire", companyEmail: "contact@tracalinge.fr",
  siret: "529 026 403 00015", tvaIntra: "FR44 529026403", rcs: "RCS Nantes 529 026 403",
  paymentTermsDays: "30", tvaRate: "20", dlnCounter: "1", invCounter: "1", clientCounter: "1",
};
for (const [k, v] of Object.entries(defaults)) setSetting(k, v);

const CATEGORIES = ["Camping", "Gîtes", "Pressing", "Hôtel", "Traiteur", "Restaurant", "Conciergerie", "VT", "Divers"];
const existingCategories = db.prepare("SELECT COUNT(*) c FROM client_categories").get().c;
if (existingCategories === 0) {
  CATEGORIES.forEach((name, i) => {
    db.prepare("INSERT INTO client_categories (id, name, sort_order) VALUES (?,?,?)").run(randomUUID(), name, i + 1);
  });
  console.log("Catégories client initialisées :", CATEGORIES.join(", "));
}

const PAYMENT_METHODS = [
  { name: "Prélèvement", days: 25 },
  { name: "Virement", days: 10 },
  { name: "Chorus Pro", days: 30 },
];
const existingMethods = db.prepare("SELECT COUNT(*) c FROM payment_methods").get().c;
if (existingMethods === 0) {
  PAYMENT_METHODS.forEach((m, i) => {
    db.prepare("INSERT INTO payment_methods (id, name, default_days, sort_order) VALUES (?,?,?,?)").run(randomUUID(), m.name, m.days, i + 1);
  });
  console.log("Modes de règlement initialisés :", PAYMENT_METHODS.map((m) => m.name).join(", "));
}

const withoutNumber = db.prepare("SELECT id FROM clients WHERE client_number IS NULL ORDER BY created_at ASC").all();
for (const row of withoutNumber) {
  db.prepare("UPDATE clients SET client_number = ? WHERE id = ?").run(nextClientNumber(), row.id);
}
if (withoutNumber.length) console.log(`${withoutNumber.length} client(s) existant(s) numéroté(s).`);

console.log("Paramètres par défaut initialisés.");
console.log("Types de linge initialisés :", LINEN_TYPES.map((t) => t.name).join(", "));
console.log("\nAmorçage terminé. Démarrez le serveur avec : npm start");

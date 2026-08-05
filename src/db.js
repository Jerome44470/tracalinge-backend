import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbFile = process.env.DB_FILE || "./data/tracalinge.db";
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS linen_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  tag TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  type_id TEXT NOT NULL REFERENCES linen_types(id),
  status TEXT NOT NULL,
  received_at INTEGER,
  shipped_at INTEGER,
  delivery_note_id TEXT,
  invoiced INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  tag TEXT NOT NULL,
  client_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT,
  device_label TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_notes (
  id TEXT PRIMARY KEY,
  numero TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'brouillon',
  sent_at INTEGER,
  invoiced INTEGER NOT NULL DEFAULT 0,
  invoice_id TEXT
);

CREATE TABLE IF NOT EXISTS delivery_note_items (
  delivery_note_id TEXT NOT NULL REFERENCES delivery_notes(id),
  tag TEXT NOT NULL,
  type_id TEXT NOT NULL,
  PRIMARY KEY (delivery_note_id, tag)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  numero TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  period_type TEXT NOT NULL,
  total_ht REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_notes (
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  delivery_note_id TEXT NOT NULL,
  PRIMARY KEY (invoice_id, delivery_note_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS device_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_client ON items(client_id);
CREATE INDEX IF NOT EXISTS idx_movements_at ON movements(at);
CREATE INDEX IF NOT EXISTS idx_dln_client ON delivery_notes(client_id);
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn("staff_users", "role", "TEXT NOT NULL DEFAULT 'staff'");
ensureColumn("linen_types", "active", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("linen_types", "sort_order", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("linen_types", "tax_type", "TEXT");
ensureColumn("linen_types", "tax_value", "REAL NOT NULL DEFAULT 0");
db.exec(`
  UPDATE linen_types SET sort_order = (SELECT COUNT(*) FROM linen_types t2 WHERE t2.rowid <= linen_types.rowid)
  WHERE sort_order = 0;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS client_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_days INTEGER NOT NULL DEFAULT 30,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS client_emails (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  email TEXT NOT NULL,
  is_contact INTEGER NOT NULL DEFAULT 0,
  is_bl INTEGER NOT NULL DEFAULT 0,
  is_facture INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  data TEXT,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  client_id TEXT
);

CREATE TABLE IF NOT EXISTS client_linen_types (
  client_id TEXT NOT NULL REFERENCES clients(id),
  type_id TEXT NOT NULL REFERENCES linen_types(id),
  price REAL NOT NULL,
  PRIMARY KEY (client_id, type_id)
);

CREATE INDEX IF NOT EXISTS idx_client_emails_client ON client_emails(client_id);
`);

ensureColumn("clients", "client_number", "TEXT");
ensureColumn("clients", "category_id", "TEXT");
ensureColumn("clients", "billing_address", "TEXT");
ensureColumn("clients", "referent_name", "TEXT");
ensureColumn("clients", "referent_phone", "TEXT");
ensureColumn("clients", "referent_email", "TEXT");
ensureColumn("clients", "accounting_name", "TEXT");
ensureColumn("clients", "accounting_phone", "TEXT");
ensureColumn("clients", "accounting_email", "TEXT");
ensureColumn("clients", "payment_method_id", "TEXT");
ensureColumn("clients", "payment_days", "INTEGER");
ensureColumn("clients", "rib", "TEXT");
ensureColumn("clients", "siret", "TEXT");
ensureColumn("clients", "bl_show_prices", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("client_linen_types", "included", "INTEGER NOT NULL DEFAULT 1");

// Un même email doit pouvoir être réutilisé pour plusieurs clients (ex. gestionnaire multi-sites).
// SQLite ne permet pas de retirer une contrainte UNIQUE via ALTER TABLE : on recrée la table une
// seule fois (migration protégée par un indicateur dans les paramètres).
if (getSetting("emailUniqueRemoved", "0") !== "1") {
  db.exec(`
    CREATE TABLE clients_new (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, email TEXT, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      client_number TEXT, category_id TEXT, billing_address TEXT,
      referent_name TEXT, referent_phone TEXT, referent_email TEXT,
      accounting_name TEXT, accounting_phone TEXT, accounting_email TEXT,
      payment_method_id TEXT, payment_days INTEGER, rib TEXT, siret TEXT, bl_show_prices INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO clients_new (id, name, address, email, password_hash, created_at, client_number, category_id, billing_address,
      referent_name, referent_phone, referent_email, accounting_name, accounting_phone, accounting_email,
      payment_method_id, payment_days, rib, siret, bl_show_prices)
    SELECT id, name, address, email, password_hash, created_at, client_number, category_id, billing_address,
      referent_name, referent_phone, referent_email, accounting_name, accounting_phone, accounting_email,
      payment_method_id, payment_days, rib, siret, bl_show_prices FROM clients;
    DROP TABLE clients;
    ALTER TABLE clients_new RENAME TO clients;
    CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
  `);
  setSetting("emailUniqueRemoved", "1");
}

export function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

export function nextClientNumber() {
  const n = parseInt(getSetting("clientCounter", "1"), 10);
  setSetting("clientCounter", n + 1);
  return `CL-${String(n).padStart(4, "0")}`;
}

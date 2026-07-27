import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbFile = process.env.DB_FILE || "./data/tracalinge.db";
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma("journal_mode = WAL"); // permet des lectures concurrentes pendant les écritures (quai + mobiles + livraison)

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

-- status: 'recu' | 'expedie' | 'perdu'
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

-- kind: 'reception' | 'expedition' | 'perte'
-- source: 'quai' | 'mobile' | 'livraison' (traçabilité de l'appareil d'origine)
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

-- status: 'brouillon' | 'envoye'
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

-- periodType: 'ponctuelle' | 'quinzaine' | 'mois'
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

export function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

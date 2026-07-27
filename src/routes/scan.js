import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireStaffOrDevice } from "../auth.js";
import { isDebounced } from "../lib/scanDebounce.js";
import { broadcastStaff } from "../realtime.js";

export const scanRouter = Router();
// Ouvert au personnel ET aux appareils de collecte (antennes fixes, PDA, terminaux de livraison) :
// c'est le seul groupe de routes que des machines appellent directement, sans session humaine.
scanRouter.use(requireStaffOrDevice);

function deviceLabel(req) {
  return req.device?.label || req.headers["x-device-label"] || (req.user ? `staff:${req.user.email}` : "inconnu");
}

/**
 * POST /api/scan/reception
 * body: { tag, clientId, typeId, source }  source: 'quai' | 'mobile' | 'livraison'
 *
 * Un tag RFID reste sur le vêtement à vie : il repasse donc par ici à chaque cycle de lavage.
 * - Si le tag est déjà "recu" (en cours de lavage) : doublon, on rejette (409).
 * - Sinon (nouveau tag, ou tag revenant d'un cycle précédent "expedie"/"perdu") : on
 *   crée/actualise la même ligne article — jamais de doublon en base pour une même puce.
 */
scanRouter.post("/reception", (req, res) => {
  const { tag, clientId, typeId, source } = req.body || {};
  if (!tag || !clientId || !typeId) return res.status(400).json({ error: "tag, clientId et typeId sont requis." });
  const normalizedTag = String(tag).trim().toUpperCase();

  if (isDebounced(normalizedTag)) {
    return res.status(200).json({ status: "debounced", message: "Relecture ignorée (fenêtre anti-doublon)." });
  }

  const existing = db.prepare("SELECT * FROM items WHERE tag = ?").get(normalizedTag);
  if (existing && existing.status === "recu") {
    return res.status(409).json({ status: "duplicate", message: "Cette puce est déjà enregistrée en cours de lavage.", item: existing });
  }

  const now = Date.now();
  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(`UPDATE items SET client_id=?, type_id=?, status='recu', received_at=?, shipped_at=NULL, delivery_note_id=NULL, invoiced=0 WHERE tag=?`)
        .run(clientId, typeId, now, normalizedTag);
    } else {
      db.prepare(`INSERT INTO items (tag, client_id, type_id, status, received_at, shipped_at, delivery_note_id, invoiced) VALUES (?,?,?,'recu',?,NULL,NULL,0)`)
        .run(normalizedTag, clientId, typeId, now);
    }
    db.prepare(`INSERT INTO movements (id, tag, client_id, type_id, kind, source, device_label, at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), normalizedTag, clientId, typeId, "reception", source || "quai", deviceLabel(req), now);
  });
  tx();

  const item = db.prepare("SELECT * FROM items WHERE tag = ?").get(normalizedTag);
  broadcastStaff("item:updated", item);
  res.json({ status: existing ? "reused" : "created", item });
});

/**
 * POST /api/scan/check
 * Validation légère d'un tag avant de l'ajouter au lot d'expédition en cours côté terminal
 * (permet un retour immédiat à l'opérateur sans attendre la validation finale du bon).
 */
scanRouter.post("/check", (req, res) => {
  const { tag, clientId } = req.body || {};
  const normalizedTag = String(tag || "").trim().toUpperCase();
  const item = db.prepare("SELECT * FROM items WHERE tag = ?").get(normalizedTag);
  if (!item) return res.json({ valid: false, reason: "introuvable" });
  if (item.client_id !== clientId) return res.json({ valid: false, reason: "autre_client" });
  if (item.status !== "recu") return res.json({ valid: false, reason: item.status === "expedie" ? "deja_expedie" : "perdu" });
  res.json({ valid: true, item });
});

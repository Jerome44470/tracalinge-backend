// Une antenne RFID fixe peut lire une même puce plusieurs fois par seconde tant qu'elle reste
// dans son champ. Ce cache mémoire ignore les relectures d'un même tag survenant dans la même
// fenêtre de quelques secondes, avant même de toucher la base de données. C'est un filtre
// complémentaire au contrôle "statut déjà en cours" fait en base (qui, lui, protège contre les
// doublons envoyés par des appareils différents ou après un redémarrage du serveur).

const DEBOUNCE_MS = 3000;
const lastSeen = new Map(); // tag -> timestamp

export function isDebounced(tag) {
  const now = Date.now();
  const prev = lastSeen.get(tag);
  lastSeen.set(tag, now);
  if (prev && now - prev < DEBOUNCE_MS) return true;
  return false;
}

// Nettoyage périodique pour ne pas laisser grossir la Map indéfiniment.
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [tag, ts] of lastSeen) if (ts < cutoff) lastSeen.delete(tag);
}, 30_000).unref();

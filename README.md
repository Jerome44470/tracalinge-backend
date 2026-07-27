# Traçalinge — Backend API

Backend Node.js/Express + SQLite qui remplace le stockage de démonstration (`window.storage`)
de l'artefact Claude par une vraie API, capable de recevoir des scans **en simultané** depuis
plusieurs points : antennes fixes au quai, PDA mobiles en atelier, terminaux de livraison.

## 1. Installation

```bash
cd tracalinge-backend
npm install
cp .env.example .env
# éditez .env : JWT_SECRET, DEVICE_KEY, ADMIN_EMAIL / ADMIN_PASSWORD, CORS_ORIGINS
npm run seed     # crée le compte staff, les types de linge, les paramètres par défaut
npm start        # démarre l'API sur http://localhost:4000
```

La base de données est un simple fichier SQLite (`./data/tracalinge.db`), suffisant pour un
seul site avec un volume de scans raisonnable. Si vous ouvrez un deuxième site ou montez fort
en volume, migrer vers PostgreSQL est le prochain palier naturel (le code SQL est simple et
proche du standard, la migration reste raisonnable).

## 2. Pourquoi c'est nécessaire

L'outil que je vous ai montré dans l'aperçu Claude fonctionne uniquement **à l'intérieur de
l'environnement Claude** : `window.storage` est une API propre aux artefacts Claude, elle
n'existe pas sur un site hébergé normalement. Ce backend est donc indispensable non seulement
pour la robustesse multi-appareils, mais tout simplement pour que l'outil puisse exister comme
un vrai site accessible depuis vos postes de quai, PDA et terminaux de livraison.

## 3. Qui appelle quoi

| Origine | Authentification | Exemple d'usage |
|---|---|---|
| Poste de bureau (personnel) | JWT staff (`/api/auth/staff/login`) | Consultation, facturation, gestion clients |
| Antenne fixe (quai) | Clé appareil (`X-Device-Key`) | `POST /api/scan/reception` en continu |
| PDA mobile (atelier) | Clé appareil ou JWT staff | Scan ponctuel, contrôle |
| Terminal de livraison | Clé appareil | `POST /api/scan/expedition` puis `POST /api/delivery-notes` en fin de tournée |
| Client (espace client) | JWT client (`/api/auth/portal/login`) | Lecture seule de ses bons/factures |

Toutes les routes de collecte (`/api/scan/*`) acceptent soit un JWT staff, soit une clé
appareil statique envoyée dans l'en-tête `X-Device-Key`. En production, préférez une clé
**par appareil** plutôt qu'une clé unique partagée (ajoutez une colonne dans `device_keys` et
comparez par appareil) — la structure de table est déjà prévue, il ne reste qu'à brancher la
vérification dans `auth.js`.

## 4. Anti-doublon (le sujet qu'on vient de traiter)

Le serveur est la source de vérité, pas le navigateur : trois filtres s'appliquent dans l'ordre,
dans `src/routes/scan.js` :

1. **Debounce mémoire** (`scanDebounce.js`) : ignore les relectures d'un même tag dans une
   fenêtre de 3 secondes — absorbe le bruit d'une antenne qui lit en continu.
2. **Contrôle de statut en base** : un tag déjà `recu` ne peut pas être reçu une deuxième fois
   (409 Conflict).
3. **Réutilisation de cycle** : un tag déjà connu (`expedie`/`perdu`) qui revient est mis à jour
   sur la même ligne article plutôt que dupliqué — un tag RFID reste sur le vêtement à vie.

## 5. Intégration des antennes fixes (portique de quai)

Une antenne fixe (Impinj R700, Zebra FX9600...) ne "tape" pas dans un champ de saisie : elle
parle le protocole **LLRP** sur le réseau local. Il faut un petit programme intermédiaire
(middleware) qui :

1. se connecte à l'antenne en LLRP (bibliothèques disponibles côté Node : `llrp-en`, ou le SDK
   du fabricant en Python/C# si plus simple pour vous),
2. reçoit chaque lecture de tag (EPC),
3. appelle `POST /api/scan/reception` (ou `/expedition` selon le portique) avec le header
   `X-Device-Key`.

Ce middleware tourne sur un petit boîtier/PC au quai, sur le même réseau que l'antenne — il
n'est pas fourni ici car il dépend du modèle exact d'antenne que vous choisirez, mais
l'intégration côté API est prête à le recevoir dès aujourd'hui.

## 6. Prochaine étape : brancher le frontend

Le fichier `tracalinge.jsx` actuel doit être transformé d'artefact Claude en vraie application
déployée (ex. avec Vite), et ses appels `window.storage.get/set` remplacés par des appels à
cette API (`fetch` + JWT stocké en mémoire/contexte React, plus Socket.IO pour le temps réel).
C'est un chantier à part entière : dites-moi si vous voulez que je m'en occupe maintenant, je
peux livrer un projet Vite complet qui réutilise l'interface déjà construite.

## 7. Résumé des routes

```
POST   /api/auth/staff/login
POST   /api/auth/portal/login

GET    /api/clients                       (staff)
POST   /api/clients                       (staff)
POST   /api/clients/:id/reset-password    (staff)

POST   /api/scan/reception                (staff ou appareil)
POST   /api/scan/check                    (staff ou appareil)

GET    /api/delivery-notes                (staff)
POST   /api/delivery-notes                (staff)
POST   /api/delivery-notes/:id/send       (staff)
PATCH  /api/delivery-notes/:id/remove-item (staff)
DELETE /api/delivery-notes/:id            (staff)

POST   /api/invoices                      (staff)
GET    /api/invoices                      (staff)
GET    /api/invoices/:id                  (staff)

GET    /api/items                         (staff)
GET    /api/items/overdue                 (staff)
POST   /api/items/:tag/declare-lost       (staff)

GET    /api/settings                      (staff)
PATCH  /api/settings                      (staff)

GET    /api/portal/delivery-notes         (client)
GET    /api/portal/invoices               (client)
```

## 8. Sécurité avant mise en production

- Servez l'API en HTTPS (reverse proxy Nginx/Caddy + certificat, ou hébergeur gérant le TLS).
- Changez `JWT_SECRET`, `DEVICE_KEY`, `ADMIN_PASSWORD` dans `.env` — les valeurs par défaut ne
  sont que des exemples.
- Sauvegardez régulièrement `data/tracalinge.db` (copie du fichier suffit).
- Envisagez une clé appareil distincte par terminal (voir section 3) pour pouvoir révoquer un
  appareil perdu/volé sans changer la clé de tous les autres.

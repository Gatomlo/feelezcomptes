# Fée Lezcomptes — budget familial

## Objectif
Appli web (PWA) de budget du foyer : revenus, dépenses fixes, budgets (enveloppes) répartis par semaine, mouvements, tags, modes de paiement, statistiques. Un seul compte partagé.

## Stack
- Node.js ≥ 22.5 (`node:sqlite`), Express, express-session, bcryptjs, dotenv. Pas de build.
- Front : JS vanilla dans une IIFE, rendu par chaînes HTML + délégation d'événements (`data-action`).

## Fichiers clés
- `src/server.js` : routes `/api/login|logout|session|account/*`, `GET/PUT /api/state`.
- `src/db.js` : SQLite (`data/app.db`), l'état complet est un seul JSON ; `src/sessionStore.js`.
- `public/app.js` : toute la logique (état, calculs, rendu, événements). `public/styles.css`, `index.html`, `sw.js`.
- `scripts/set-password.js` : `npm run set-password -- identifiant motdepasse`.

## Modèle de données (non évident)
- `state = { recurring: { incomes, fixedExpenses, envelopes, tags, paymentMethods }, months: { 'YYYY-MM': {...} }, settings: { weekStartDay, defaultPaymentMethodId } }`.
- **Mois budgétaire = semaines pleines** : une semaine (démarrant à `weekStartDay`) appartient entièrement au mois où elle a ≥ 4 jours (`monthWeeks`). Un mois a donc 4 ou 5 semaines et peut déborder sur le mois voisin (ex. septembre finit le 02/10).
- **Un mouvement est affiché/compté dans le mois budgétaire de sa date** (`budgetMonthKeyForDate`, `movementMonthKey`), quel que soit `months[key]` où il est stocké. `computeMonthView` parcourt donc tous les mois ; pour modifier/supprimer, retrouver le mouvement avec `findMovementMonthKey(id)`. Exception : un mouvement lié à un budget ponctuel (`ephemeralEnvelopes`) reste dans le mois de ce budget.
- Revenus/fixes/budgets récurrents bornés par `startMonth`/`endMonth` ; surcharges par mois (`incomeAmounts`, `fixedAmounts`, `envelopeAmounts`, `envelopeWeeks`, `removed*`).
- Un revenu rattaché à un budget le recrédite (remboursement) au lieu de compter comme revenu.
- Mouvements : glisser (tactile) ou boutons ✏️/🗑️ (souris, via `@media (hover: hover) and (pointer: fine)`).

## Commandes
- Local : `npm install`, `cp .env.example .env`, `npm start` → http://localhost:3000 (`COOKIE_SECURE=false`).
- Test isolé : lancer avec `PORT`, `DATA_DIR`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` dédiés (base vide) et injecter un état via `PUT /api/state`.
- Pas de tests automatisés ; vérifier au minimum `node --check public/app.js`.
- Déploiement : VPS + pm2 + nginx, voir `README.md`.
- Git : https://github.com/Gatomlo/feelezcomptes (public — ne jamais versionner `.env`, `test.env`, ni de base `*.db`).

## Méthode de travail
- Répondre en français, concis. Lire des extraits ciblés de `app.js` (≈ 2100 lignes) plutôt que le fichier entier.
- Ne jamais toucher à `data/app.db` ni à `.env` (données réelles) pour tester.

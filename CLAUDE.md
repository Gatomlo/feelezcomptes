# Fée Lezcomptes — budget familial

## Objectif
Appli web (PWA) de budget du foyer : revenus, dépenses fixes, budgets (enveloppes) répartis par semaine, mouvements, tags, modes de paiement, statistiques. Un seul compte partagé.

## Stack
- Node.js ≥ 22.5 (`node:sqlite`), Express, express-session, bcryptjs, dotenv. Pas de build.
- Front : JS vanilla dans une IIFE, rendu par chaînes HTML + délégation d'événements (`data-action`). Interface mobile d'abord (tons beige / terracotta, polices Bricolage Grotesque + Manrope).

## Fichiers clés
- `src/server.js` : routes `/api/login|logout|session|account/*`, `GET/PUT /api/state` (version dans l'en-tête `X-State-Version` ; PUT avec `X-Base-Version` dépassée → 409 + état actuel).
- `src/db.js` : SQLite (`data/app.db`), l'état complet est un seul JSON + colonne `version` ; `src/sessionStore.js`.
- `public/app.js` : toute la logique (état, calculs, rendu, événements). `public/styles.css`, `index.html`, `sw.js`.
- `scripts/set-password.js` : `npm run set-password -- identifiant motdepasse`.
- Logo : `public/logo.svg` (bourse ailée, fond terracotta) ; `python scripts/make-icons.py` régénère `logo.png`, `icon-192/384.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (rendu Edge/Chrome sans fenêtre + Pillow).

## Modèle de données (non évident)
- `state = { recurring: { incomes, fixedExpenses, envelopes, tags, paymentMethods }, months: { 'YYYY-MM': {...} }, settings: { weekStartDay, defaultPaymentMethodId } }`.
- **Mois budgétaire = semaines pleines** : une semaine (démarrant à `weekStartDay`) appartient entièrement au mois où elle a ≥ 4 jours (`monthWeeks`). Un mois a donc 4 ou 5 semaines et peut déborder sur le mois voisin (ex. septembre finit le 02/10).
- **Un mouvement est affiché/compté dans le mois budgétaire de sa date** (`budgetMonthKeyForDate`, `movementMonthKey`), quel que soit `months[key]` où il est stocké. `computeMonthView` parcourt donc tous les mois ; pour modifier/supprimer, retrouver le mouvement avec `findMovementMonthKey(id)`. Exception : un mouvement lié à un budget ponctuel (`ephemeralEnvelopes`) reste dans le mois de ce budget.
- Revenus/fixes/budgets récurrents bornés par `startMonth`/`endMonth` ; surcharges par mois (`incomeAmounts`, `fixedAmounts`, `envelopeAmounts`, `envelopeWeeks`, `removed*`).
- Un revenu rattaché à un budget le recrédite (remboursement) au lieu de compter comme revenu.
- **Hors-ligne / synchro** (`app.js`, section « Synchronisation ») : état gardé dans localStorage (`fee-lezcomptes-data` : state, base = dernier état serveur, version, dirty). Chaque modif est écrite localement puis envoyée ; en cas de 409, `merge3(base, local, serveur)` (objets par clé, listes d'objets par `id`, listes simples comme ensembles ; conflit : l'appareil gagne). Réessai toutes les 15 s, à l'événement `online`, au retour au premier plan. Ouverture sans réseau = copie locale. Déconnexion refusée tant que `dirty`. Pas de rendu sous une modale ouverte (`safeRender`).
- `sw.js` : interface en réseau d'abord (repli cache après 4 s), `/api` non intercepté ; changer `VERSION` si `FILES` change. Non testable dans le navigateur intégré (pas de service worker).
- **Installation** : bandeau masquable sur l'accueil (`fee-lezcomptes-install-hidden`) + carte « Application » des réglages. Raccourci du manifest (appui long sur l'icône) → `?action=nouveau-mouvement` → `handleLaunchAction` ouvre la modale d'ajout.
- **Interface** (`app.js`, section « Rendu ») : pages `currentPage` = dashboard (accueil), movements, fixed, stats, settings (roue dentée en haut), budget (détail, `budgetDetailId`). Barre du bas Accueil · Mouvements · ＋ · Fixes · Stats. Feuilles = `<dialog class="sheet">` ; `openSheet` = feuille rouverte après un re-rendu (filtres, vue) ; la feuille d'ajout (`movement-modal`) et le sélecteur (`picker-sheet`) se mettent à jour sans re-rendu (`setSheetSelection`, `refreshSheetChips`) pour garder la saisie. `render()` restaure le focus des champs portant `data-focus-key`.
- Budgets de l'accueil : grand chiffre = reste réel de la semaine (`effectiveWeeks[w] - spentByWeek[w]`) ; pied « dispo / prévu » (dispo = `effectiveWeeks[w]`, prévu = `weeks[w]`, dispo en rouge s'il y a un report) ; jauge = dépensé / dispo. Explications derrière des boutons ⓘ (`infoBtn` / `infoText`, état `infoOpen`).
- Mouvements : toucher une ligne dévoile Modifier / Supprimer (`revealedMovementId`) ; suppression avec « Annuler » dans le toast (`#toast` hors de `#app`, `showToast(msg, libellé, fn)`). Filtres : type, budget, tag, mode de paiement (`'none'` = sans). Vues : semaine, budget, tag, paiement.
- Les réglages réutilisent les anciens formulaires (`data-field` traités par `onChange`), restylés.

## Commandes
- Local : `npm install`, `cp .env.example .env`, `npm start` → http://localhost:3000 (`COOKIE_SECURE=false`).
- Test isolé : lancer avec `PORT`, `DATA_DIR`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` dédiés (base vide) et injecter un état via `PUT /api/state`.
- Pas de tests automatisés ; vérifier au minimum `node --check public/app.js`.
- Déploiement : VPS + pm2 + nginx, voir `README.md`. Le serveur (`/home/debian/fee-lezcomptes`) est un clone git : mise à jour = `git pull && npm install --omit=dev && pm2 restart fee-lezcomptes`.
- Git : https://github.com/Gatomlo/feelezcomptes (public — ne jamais versionner `.env`, `test.env`, ni de base `*.db`).

## Méthode de travail
- Répondre en français, concis. Lire des extraits ciblés de `app.js` (≈ 2100 lignes) plutôt que le fichier entier.
- Ne jamais toucher à `data/app.db` ni à `.env` (données réelles) pour tester.

# Fée Lezcomptes — serveur

Version déployable de l'application de budget familial : un petit serveur Node.js qui stocke les données dans une vraie base **SQLite** (un fichier sur le serveur) et protège l'accès avec un mot de passe **haché** (jamais stocké ni affiché en clair), au lieu de vivre entièrement dans la page comme la version Artifact.

## Ce qui a changé par rapport à la version Artifact

- Les données (revenus, dépenses, budgets, mouvements…) sont stockées dans `data/app.db` (SQLite) sur le serveur, pas dans la page.
- Le mot de passe est haché (bcrypt) avant d'être stocké — personne (pas même toi en regardant la base) ne peut le relire en clair. Pour le changer, il faut connaître l'ancien.
- La connexion utilise un vrai système de sessions sécurisées (cookie `httpOnly`), avec une limite anti-brute-force sur la page de connexion (10 tentatives / 15 minutes).
- Chaque appareil connecté recharge automatiquement les données toutes les 20 secondes (et à chaque retour sur l'onglet), pour rester synchronisé si quelqu'un d'autre modifie le budget ailleurs.

## 1. Est-ce que je peux faire tourner ça sur mon hébergement OVH ?

Ce serveur a besoin de faire tourner un **process Node.js en continu**. Deux cas :

- **VPS OVH** (ou tout serveur avec accès SSH) : oui, sans problème, c'est le cas prévu ci-dessous.
- **Hébergement web mutualisé OVH** (Perso/Pro/Performance) : certaines offres récentes proposent un module "Node.js" dans l'espace client OVH (Hébergements > ton offre > onglet **Multisite/Node.js**). Si tu vois cette option, tu peux déployer ce dossier tel quel (le fichier d'entrée est `src/server.js`, le port est fourni par la variable `PORT`). Si tu ne trouves pas cette option, ton offre ne permet probablement pas de lancer un serveur Node.js — dans ce cas il faut soit passer sur un VPS OVH, soit demander à OVH support/chat quel plan le permet.

**Pour vérifier** : connecte-toi sur [ovh.com/manager](https://www.ovh.com/manager/), va dans la liste de tes services. Si tu vois "VPS" dans le menu de gauche, tu as un VPS (suis la section 2). Si tu vois "Hébergements web", regarde s'il y a un onglet "Node.js" dans les réglages de ton site.

## 2. Déploiement sur un VPS OVH (recommandé)

### a) Se connecter au VPS

Depuis un terminal (PowerShell sur Windows, ou l'app "Terminal") :

```bash
ssh debian@IP_DE_TON_VPS
```

(remplace `debian` par l'utilisateur indiqué dans l'email OVH, et `IP_DE_TON_VPS` par l'adresse IP visible dans ton espace client OVH)

### b) Installer Node.js

Ce projet utilise le module SQLite intégré à Node.js (`node:sqlite`), qui demande **Node.js 22.5 ou plus récent**. Aucun compilateur n'est nécessaire (contrairement à d'autres bibliothèques SQLite pour Node).

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # doit afficher v22.5.0 ou plus
```

### c) Copier le projet sur le serveur

Depuis ta machine, dans le dossier `budget-foyer-server` :

```bash
scp -r . debian@IP_DE_TON_VPS:/home/debian/fee-lezcomptes
```

(ou utilise `git clone` si tu mets le projet sur un dépôt Git)

### d) Installer les dépendances et configurer

Sur le VPS :

```bash
cd /home/debian/fee-lezcomptes
npm install
cp .env.example .env
nano .env   # modifie SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD
```

Génère un `SESSION_SECRET` solide avec :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Colle le résultat dans `.env`.

### e) Lancer le serveur en continu avec pm2

```bash
sudo npm install -g pm2
pm2 start src/server.js --name fee-lezcomptes
pm2 save
pm2 startup   # suis l'instruction affichée pour démarrer pm2 au boot du serveur
```

Le site tourne maintenant sur `http://IP_DE_TON_VPS:3000`.

### f) Mettre un nom de domaine + HTTPS devant (nginx + Let's Encrypt)

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Crée `/etc/nginx/sites-available/fee-lezcomptes` :

```nginx
server {
    listen 80;
    server_name budget.tondomaine.fr;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Puis :

```bash
sudo ln -s /etc/nginx/sites-available/fee-lezcomptes /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d budget.tondomaine.fr
```

Certbot configure le HTTPS automatiquement. Une fois fait, dans `.env` sur le serveur, mets :

```
COOKIE_SECURE=true
```

puis redémarre : `pm2 restart fee-lezcomptes`. **Sans cette étape, le cookie de connexion refusera de fonctionner en HTTPS.**

N'oublie pas de pointer un enregistrement DNS (type A) de `budget.tondomaine.fr` vers l'IP du VPS, depuis l'espace client OVH (zone DNS de ton nom de domaine).

## 3. Premier lancement

Au tout premier démarrage, si aucun compte n'existe, un compte est créé automatiquement avec `ADMIN_USERNAME` / `ADMIN_PASSWORD` (définis dans `.env`). **Change le mot de passe tout de suite** depuis Réglages > Compte une fois connecté, ou via :

```bash
npm run set-password -- monidentifiant monnouveaumotdepasse
```

(à lancer sur le serveur, dans le dossier du projet)

## 4. Sauvegardes

Toutes les données vivent dans `data/app.db`. Pour sauvegarder, il suffit de copier ce fichier régulièrement (par exemple avec une tâche cron qui fait `cp data/app.db backups/app-$(date +%F).db`).

## 5. Développement / test en local

```bash
npm install
cp .env.example .env
npm start
```

Puis ouvre `http://localhost:3000`. En local (`http://`, pas `https://`), laisse `COOKIE_SECURE=false` dans `.env`, sinon le cookie de session ne sera pas envoyé par le navigateur.

## Limites connues (assumées pour un usage familial simple)

- Un seul compte partagé pour tout le foyer (comme avant), pas de comptes multiples avec des rôles différents.
- Pas de protection CSRF dédiée au-delà du cookie `SameSite=Lax` — suffisant pour un usage privé sur un domaine à toi, mais à garder en tête si tu exposes ce serveur plus largement.
- La synchronisation entre appareils se fait par relecture périodique (toutes les 20 secondes), pas en temps réel instantané.

## Notifications des dépenses planifiées (facultatif)

Le jour de leur date, les dépenses planifiées peuvent déclencher une notification « Avez-vous dépensé … ? » (Oui / Reporter / Annuler).

1. `npm run vapid` génère une paire de clés ; recopie-les dans `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, voir `.env.example`, ainsi que `APP_TZ` et `PUSH_HOUR`).
2. `npm install --omit=dev` puis `pm2 restart fee-lezcomptes`.
3. Sur chaque appareil : Réglages > Notifications > Activer (sur iPhone, l'app doit d'abord être installée sur l'écran d'accueil).

Sans clés, la carte « À confirmer » de l'accueil rappelle quand même les dépenses arrivées à échéance.

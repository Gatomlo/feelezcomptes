"use strict";

const path = require("path");
// Chemin explicite (pas le repertoire courant du process) : reste correct meme charge
// par une passerelle qui tourne depuis un autre dossier.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");

const db = require("./db");
const SqliteSessionStore = require("./sessionStore");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === "change-this-to-a-long-random-string") {
  if (IS_PROD) {
    // throw plutôt que process.exit : monté par la passerelle, un exit arrêterait
    // aussi les autres outils ; l'exception, elle, n'annule que le montage de celui-ci.
    throw new Error(
      "[Fée Lezcomptes] SESSION_SECRET manquant ou laissé par défaut dans .env. " +
        "Définis une vraie valeur secrète avant de démarrer en production."
    );
  }
  sessionSecret = crypto.randomBytes(48).toString("hex");
  console.warn(
    "[Fée Lezcomptes] SESSION_SECRET absent : une valeur temporaire a été générée. " +
      "Les sessions seront invalidées à chaque redémarrage tant que tu n'en fixes pas une dans .env."
  );
}

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    // HSTS seulement en HTTPS (en local http://localhost, il gênerait).
    strictTransportSecurity: process.env.COOKIE_SECURE === "true",
  })
);
app.use(express.json({ limit: "2mb" }));

// Anti-CSRF : une requête qui modifie des données doit venir de notre propre origine
// (en-tête Origin, envoyé par les navigateurs sur les POST/PUT). Sans Origin (curl, service
// worker same-origin), on laisse passer : le cookie SameSite=Lax couvre déjà le cross-site.
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("Origin");
  if (origin && origin !== req.protocol + "://" + req.get("host")) {
    return res.status(403).json({ error: "forbidden_origin" });
  }
  next();
});

const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 jours
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000; // 12 heures si "se souvenir de moi" est décoché

app.use(
  session({
    store: new SqliteSessionStore(),
    secret: sessionSecret,
    name: "fee_lezcomptes_sid",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: SESSION_MAX_AGE,
    },
  })
);

// Connexion centralisee de node-gateway (voir gatewayLogin.js) : sans effet hors passerelle.
app.use(require("./gatewayLogin"));

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: "not_authenticated" });
}

// --- Auth ---

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessaie dans quelques minutes." },
});

app.post("/api/login", loginLimiter, (req, res) => {
  const { username, password, remember } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  }
  const user = db.getUser(username.trim());
  if (!user) {
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  }
  bcrypt.compare(password, user.password_hash, (err, ok) => {
    if (err || !ok) {
      return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
    }
    req.session.regenerate((regenErr) => {
      if (regenErr) return res.status(500).json({ error: "Erreur serveur." });
      req.session.userId = user.id;
      req.session.cookie.maxAge = remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE;
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "Erreur serveur." });
        res.json({ ok: true, username: user.username });
      });
    });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("fee_lezcomptes_sid");
    res.json({ ok: true });
  });
});

app.get("/api/session", (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ authenticated: false });
  const user = db.getFirstUser();
  res.json({ authenticated: true, username: user ? user.username : null });
});

// --- Compte ---

app.post("/api/account/username", requireAuth, (req, res) => {
  const { username } = req.body || {};
  if (typeof username !== "string" || !username.trim()) {
    return res.status(400).json({ error: "Identifiant invalide." });
  }
  const trimmed = username.trim();
  const existing = db.getUser(trimmed);
  if (existing && existing.id !== req.session.userId) {
    return res.status(409).json({ error: "Cet identifiant est déjà utilisé." });
  }
  db.updateUsername(req.session.userId, trimmed);
  res.json({ ok: true, username: trimmed });
});

// Déconnecte tous les autres appareils (après changement de mot de passe).
function purgeOtherSessions(currentSid) {
  try {
    db.db.prepare("DELETE FROM sessions WHERE sid != ?").run(currentSid);
  } catch (e) {}
}

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessaie dans quelques minutes." },
});

app.post("/api/account/password", requireAuth, passwordLimiter, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "Le nouveau mot de passe doit contenir au moins 8 caractères." });
  }
  const user = db.getFirstUser();
  if (!user || user.id !== req.session.userId) {
    return res.status(401).json({ error: "not_authenticated" });
  }
  bcrypt.compare(currentPassword, user.password_hash, (err, ok) => {
    if (err || !ok) {
      return res.status(401).json({ error: "Mot de passe actuel incorrect." });
    }
    const hash = bcrypt.hashSync(newPassword, 12);
    db.updatePasswordHash(user.id, hash);
    purgeOtherSessions(req.sessionID);
    res.json({ ok: true });
  });
});

// --- État du budget ---

// La version de l'etat voyage dans l'en-tete X-State-Version (le corps reste l'etat seul).
app.get("/api/state", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-State-Version", String(db.getStateVersion()));
  res.json(db.getState());
});

// Les `id` sont réinjectés dans des attributs HTML par le front : on refuse tout id
// qui ne ressemble pas à ceux générés par l'appli (prefixe_base36), pour fermer l'auto-XSS.
const SAFE_ID = /^[\w.:-]{1,80}$/;
function hasUnsafeId(node, depth) {
  if (depth > 12 || node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => hasUnsafeId(n, depth + 1));
  return Object.keys(node).some((k) => {
    const v = node[k];
    if (k === "id" && typeof v === "string") return !SAFE_ID.test(v);
    return hasUnsafeId(v, depth + 1);
  });
}

app.put("/api/state", requireAuth, (req, res) => {
  const state = req.body;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return res.status(400).json({ error: "Format invalide." });
  }
  if (hasUnsafeId(state, 0)) {
    return res.status(400).json({ error: "Identifiant invalide dans l'état." });
  }
  // X-Base-Version : version sur laquelle le client a construit son etat. Si elle est
  // depassee, 409 avec l'etat actuel : le client fusionne ses modifications et renvoie.
  const baseHeader = req.get("X-Base-Version");
  const base = baseHeader != null && /^\d+$/.test(baseHeader) ? Number(baseHeader) : null;
  const version = db.saveState(state, base);
  if (version == null) {
    res.set("X-State-Version", String(db.getStateVersion()));
    return res.status(409).json({ error: "conflict", state: db.getState() });
  }
  res.set("X-State-Version", String(version));
  res.json({ ok: true, version });
});

// --- Notifications push (dépenses planifiées) ---

require("./push").mount(app, requireAuth);

// --- Fichiers statiques (front-end) ---

app.use(express.static(path.join(__dirname, "..", "public")));

// Lance seul (node src/server.js) : demarre son propre serveur HTTP comme avant.
// Charge par une passerelle (require(...)) : exporte juste l'app Express, montee sur
// une route par la passerelle — pas de app.listen() ici dans ce cas.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log("[Fée Lezcomptes] Serveur démarré sur http://localhost:" + PORT);
  });
}
module.exports = app;

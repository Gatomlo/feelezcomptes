"use strict";

const path = require("path");
// Chemin explicite (pas le repertoire courant du process) : reste correct meme charge
// par une passerelle qui tourne depuis un autre dossier.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
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
app.use(express.json({ limit: "2mb" }));

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

app.post("/api/account/password", requireAuth, (req, res) => {
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
    res.json({ ok: true });
  });
});

// --- État du budget ---

app.get("/api/state", requireAuth, (req, res) => {
  res.json(db.getState());
});

app.put("/api/state", requireAuth, (req, res) => {
  const state = req.body;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return res.status(400).json({ error: "Format invalide." });
  }
  db.saveState(state);
  res.json({ ok: true });
});

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

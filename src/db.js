"use strict";

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

// path.resolve avec un chemin relatif (ex. DATA_DIR=./data) le resout par rapport a
// ce projet (__dirname/..), pas par rapport au dossier de demarrage du process — utile
// quand ce module est charge par une passerelle qui tourne depuis un autre dossier. Un
// DATA_DIR absolu dans .env continue de fonctionner tel quel (path.resolve le respecte).
const DATA_DIR = path.resolve(__dirname, "..", process.env.DATA_DIR || "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS budget_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    data TEXT NOT NULL
  );
`);

const DEFAULT_STATE = {
  recurring: { incomes: [], fixedExpenses: [], envelopes: [], tags: [] },
  months: {},
  settings: { weekStartDay: 1 },
};

function ensureDefaultUser() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || "foyer";
  const password = process.env.ADMIN_PASSWORD || "change-me-now";
  const hash = bcrypt.hashSync(password, 12);
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
  console.warn(
    "\n[Fée Lezcomptes] Aucun compte trouvé : un compte a été créé avec l'identifiant \"" +
      username +
      "\".\n" +
      "  -> Change le mot de passe tout de suite depuis Réglages > Compte,\n" +
      "     ou avec : npm run set-password -- " +
      username +
      " <nouveau_mot_de_passe>\n"
  );
}

function ensureDefaultState() {
  const row = db.prepare("SELECT id FROM budget_state WHERE id = 1").get();
  if (row) return;
  db.prepare("INSERT INTO budget_state (id, data) VALUES (1, ?)").run(JSON.stringify(DEFAULT_STATE));
}

ensureDefaultUser();
ensureDefaultState();

function getUser(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

function getFirstUser() {
  return db.prepare("SELECT * FROM users ORDER BY id LIMIT 1").get();
}

function updateUsername(id, newUsername) {
  db.prepare("UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?").run(newUsername, id);
}

function updatePasswordHash(id, hash) {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, id);
}

function getState() {
  const row = db.prepare("SELECT data FROM budget_state WHERE id = 1").get();
  return row ? JSON.parse(row.data) : JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveState(state) {
  const json = JSON.stringify(state);
  db.prepare(
    "UPDATE budget_state SET data = ?, updated_at = datetime('now') WHERE id = 1"
  ).run(json);
}

module.exports = {
  db,
  getUser,
  getFirstUser,
  updateUsername,
  updatePasswordHash,
  getState,
  saveState,
  DEFAULT_STATE,
};

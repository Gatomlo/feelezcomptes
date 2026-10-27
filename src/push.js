"use strict";

// Notifications push (niveau 2) : le jour de leur date, les dépenses planifiées
// déclenchent « Avez-vous dépensé … ? » sur les appareils abonnés.

const webpush = require("web-push");
const db = require("./db");

const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@localhost";
const TZ = process.env.APP_TZ || "Europe/Brussels";
const PUSH_HOUR = Number(process.env.PUSH_HOUR || 9);
const CHECK_MS = 5 * 60 * 1000;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS push_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_sent (
    mv_id TEXT NOT NULL,
    date TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (mv_id, date)
  );
`);

// Clés VAPID : celles du .env si elles y sont, sinon générées au premier démarrage et
// gardées dans la base (aucune étape manuelle). Les perdre obligerait à réactiver les
// notifications sur chaque appareil.
function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const get = (k) => { const r = db.db.prepare("SELECT value FROM push_config WHERE key = ?").get(k); return r ? r.value : null; };
  let publicKey = get("vapid_public"), privateKey = get("vapid_private");
  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
    db.db.prepare("INSERT OR REPLACE INTO push_config (key, value) VALUES ('vapid_public', ?)").run(publicKey);
    db.db.prepare("INSERT OR REPLACE INTO push_config (key, value) VALUES ('vapid_private', ?)").run(privateKey);
  }
  return { publicKey, privateKey };
}
const KEYS = loadKeys();
const PUBLIC_KEY = KEYS.publicKey;
const PRIVATE_KEY = KEYS.privateKey;
const ENABLED = true;
webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

// Date (AAAA-MM-JJ) et heure du moment dans le fuseau de l'appli.
function localNow(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now || new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: get("year") + "-" + get("month") + "-" + get("day"), hour: Number(get("hour")) };
}

function listSubscriptions() {
  return db.db.prepare("SELECT endpoint, data FROM push_subscriptions").all().map((r) => ({ endpoint: r.endpoint, sub: JSON.parse(r.data) }));
}

function eur(n) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
}

function plannedMovements(state) {
  const out = [];
  Object.keys(state.months || {}).forEach((k) => {
    ((state.months[k] || {}).movements || []).forEach((mv) => { if (mv.planned) out.push({ monthKey: k, mv }); });
  });
  return out;
}

function budgetName(state, mv) {
  if (!mv.envelopeId) return "Hors budget";
  const env = (state.recurring.envelopes || []).find((e) => e.id === mv.envelopeId);
  if (env) return env.name;
  for (const k of Object.keys(state.months || {})) {
    const eph = ((state.months[k] || {}).ephemeralEnvelopes || []).find((e) => e.id === mv.envelopeId);
    if (eph) return eph.name;
  }
  return "Hors budget";
}

async function sendToAll(payload) {
  const subs = listSubscriptions();
  if (!subs.length) return 0;
  let ok = 0;
  await Promise.all(subs.map(async ({ endpoint, sub }) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      ok++;
    } catch (err) {
      // Abonnement expiré ou révoqué : on l'oublie.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        db.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
      } else {
        console.warn("[push] envoi impossible :", err && err.message);
      }
    }
  }));
  return ok;
}

// Envoie, une seule fois par (mouvement, date), la question du jour J.
async function checkDue(now) {
  if (!ENABLED) return;
  const t = localNow(now);
  if (t.hour < PUSH_HOUR) return;
  if (!listSubscriptions().length) return;
  const state = db.getState();
  for (const { mv } of plannedMovements(state)) {
    if (mv.date > t.date) continue;
    const seen = db.db.prepare("SELECT 1 FROM push_sent WHERE mv_id = ? AND date = ?").get(mv.id, mv.date);
    if (seen) continue;
    const sent = await sendToAll({
      title: "Avez-vous dépensé " + eur(mv.amount) + " ?",
      body: mv.label + " · " + budgetName(state, mv),
      id: mv.id,
    });
    if (sent) db.db.prepare("INSERT OR IGNORE INTO push_sent (mv_id, date) VALUES (?, ?)").run(mv.id, mv.date);
  }
}

// Confirmer ou annuler un planifié depuis les boutons de la notification : mêmes règles
// que dans l'appli (confirmé avant sa date, il prend la date du jour).
function resolvePlanned(id, action) {
  const state = db.getState();
  const hit = plannedMovements(state).find((x) => x.mv.id === id);
  if (!hit) return false;
  if (action === "confirm") {
    delete hit.mv.planned;
    const today = localNow().date;
    if (hit.mv.date > today) hit.mv.date = today;
  } else {
    state.months[hit.monthKey].movements = state.months[hit.monthKey].movements.filter((m) => m.id !== id);
  }
  db.saveState(state);
  return true;
}

function mount(app, requireAuth) {
  app.get("/api/push/key", requireAuth, (req, res) => {
    res.json({ enabled: ENABLED, key: ENABLED ? PUBLIC_KEY : null });
  });

  app.post("/api/push/subscribe", requireAuth, (req, res) => {
    const sub = req.body;
    if (!ENABLED) return res.status(503).json({ error: "Notifications non configurées sur le serveur." });
    if (!sub || typeof sub.endpoint !== "string" || !sub.keys) return res.status(400).json({ error: "Abonnement invalide." });
    db.db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, data) VALUES (?, ?)").run(sub.endpoint, JSON.stringify(sub));
    res.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", requireAuth, (req, res) => {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint === "string") db.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
    res.json({ ok: true });
  });

  app.post("/api/push/test", requireAuth, async (req, res) => {
    if (!ENABLED) return res.status(503).json({ error: "Notifications non configurées sur le serveur." });
    const sent = await sendToAll({ title: "Notifications activées", body: "Vous recevrez ici le rappel de vos dépenses planifiées.", id: "" });
    res.json({ ok: true, sent });
  });

  app.post("/api/planned/:id/:action", requireAuth, (req, res) => {
    const action = req.params.action;
    if (action !== "confirm" && action !== "cancel") return res.status(400).json({ error: "Action inconnue." });
    if (!resolvePlanned(req.params.id, action)) return res.status(404).json({ error: "Mouvement planifié introuvable." });
    res.json({ ok: true });
  });

  if (ENABLED) {
    const timer = setInterval(() => { checkDue().catch((e) => console.warn("[push]", e && e.message)); }, CHECK_MS);
    if (timer.unref) timer.unref();
    setTimeout(() => { checkDue().catch(() => {}); }, 10 * 1000).unref();
    console.log("[Fée Lezcomptes] Notifications push actives (rappel à partir de " + PUSH_HOUR + " h, " + TZ + ").");
  }
}

module.exports = { mount, checkDue, resolvePlanned, localNow };

"use strict";
// Connexion centralisee de node-gateway : req.gateway (pose par la passerelle) ouvre une session locale pour le
// compte de meme identifiant (aucun compte cree) ; elle tombe des que la passerelle ne se porte plus garante.
// Une connexion locale normale n'est jamais touchee. Hors passerelle : inchange.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-bridge-"));
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "secret-de-test-" + Math.random().toString(36).slice(2) + "-assez-long-pour-passer";
const express = require("express");
const db = require("../src/db");
const app = require("../src/server");

const gw = (login, role = "member") => ({ "x-test-gateway": JSON.stringify({ app: "outil", role, user: { login, name: login, email: null, isSuper: false } }) });
let srv, base;
const session = (headers = {}) => fetch(base + "/api/session", { headers }).then(async (r) => ({ r, j: await r.json() }));

test.before(async () => {
  // L'app cree elle-meme un compte par defaut au demarrage ("foyer") : c'est lui que la passerelle doit retrouver.
  assert.ok(db.getFirstUser(), "compte par defaut");
  const outer = express();
  outer.use((req, res, next) => { const h = req.get("x-test-gateway"); if (h) req.gateway = JSON.parse(h); next(); });
  outer.use("/outil", app);
  srv = http.createServer(outer);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}/outil`;
});
test.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); setImmediate(() => process.exit(0)); });

test("identifiant de la passerelle -> compte local de meme identifiant (cookie court)", async () => {
  const { r, j } = await session(gw("FOYER"));
  assert.equal(j.authenticated, true);
  assert.equal(j.username, "foyer");
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/outil\//, "cookie limite au chemin de montage");
  const exp = new Date(/Expires=([^;]+)/.exec(cookie)[1]).getTime() - Date.now();
  assert.ok(exp > 60 * 60 * 1000 && exp <= 2 * 60 * 60 * 1000 + 5000, "cookie de 2 h au plus, obtenu " + exp);
  const again = await session({ ...gw("foyer"), cookie: cookie.split(";")[0] });
  assert.equal(again.j.authenticated, true);
});

test("la session passerelle tombe des que la passerelle ne se porte plus garante", async () => {
  const cookie = (await session(gw("foyer"))).r.headers.get("set-cookie").split(";")[0];
  assert.equal((await session({ cookie })).j.authenticated, false, "sans passerelle (deconnexion / droit retire)");
  const c2 = (await session(gw("foyer"))).r.headers.get("set-cookie").split(";")[0];
  assert.equal((await session({ ...gw("autre"), cookie: c2 })).j.authenticated, false, "autre compte");
});

test("aucun compte cree : inconnu, anonyme ou sans droit => pas connecte", async () => {
  for (const h of [gw("inconnu"), {}, { "x-test-gateway": JSON.stringify({ app: "outil", role: null, user: { login: "foyer" } }) }]) {
    assert.equal((await session(h)).j.authenticated, false);
  }
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
});

test('crochet gatewayAccounts : liste des comptes pour l\'administration de la passerelle, sans aucun secret', () => {
  const list = app.gatewayAccounts();
  assert.ok(Array.isArray(list) && list.length >= 1, 'au moins un compte');
  for (const a of list) {
    assert.ok(a.key, 'cle a saisir dans « compte local »');
    assert.doesNotMatch(JSON.stringify(a), /hash|passw|token|secret|scrypt|bcrypt/i);
  }
});

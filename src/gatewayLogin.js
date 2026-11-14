"use strict";

// Connexion centralisee de node-gateway : si la passerelle fournit req.gateway (droit sur cet outil), ouvre une
// session pour le compte de meme identifiant (aucun compte cree). Cette session ne vaut que tant que la
// passerelle se porte garante du meme compte : des qu'elle ne le fait plus (deconnexion, droit retire), elle
// tombe (controle a chaque requete). Une session locale normale n'est jamais touchee. Hors passerelle : sans effet.
const { db } = require("./db");
const bridge = require("./gateway-bridge");

const BRIDGE_MAX_AGE = 2 * 60 * 60 * 1000;

function localUser(req) {
  const id = bridge.identity(req);
  if (!id) return null;
  return bridge.matchLocal(id, db.prepare("SELECT id, username FROM users").all(), { email: null, login: "username" });
}

function gatewayLogin(req, res, next) {
  const s = req.session;
  if (!s) return next();
  if (s.viaGateway) {
    const u = localUser(req);
    if (u && u.id === s.userId) return next();
    return s.destroy(() => next());
  }
  if (s.userId) return next();
  const u = localUser(req);
  if (!u) return next();
  s.regenerate((err) => {
    if (err) return next(err);
    const fresh = req.session; // regenerate() remplace req.session : ne pas toucher l'ancien objet
    fresh.userId = u.id;
    fresh.viaGateway = true;
    fresh.cookie.maxAge = BRIDGE_MAX_AGE;
    fresh.save((err2) => next(err2));
  });
}

module.exports = gatewayLogin;

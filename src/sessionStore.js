"use strict";

const session = require("express-session");
const { db } = require("./db");

const upsert = db.prepare(
  "INSERT INTO sessions (sid, expires, data) VALUES (@sid, @expires, @data) " +
    "ON CONFLICT(sid) DO UPDATE SET expires = @expires, data = @data"
);
const selectBySid = db.prepare("SELECT data, expires FROM sessions WHERE sid = ?");
const deleteBySid = db.prepare("DELETE FROM sessions WHERE sid = ?");
const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires < ?");
const countAll = db.prepare("SELECT COUNT(*) AS n FROM sessions");
const clearAll = db.prepare("DELETE FROM sessions");

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    // Nettoyage périodique des sessions expirées pour ne pas faire grossir la table indéfiniment.
    this._cleanupTimer = setInterval(() => {
      try {
        deleteExpired.run(Date.now());
      } catch (e) {}
    }, 60 * 60 * 1000);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  get(sid, cb) {
    try {
      const row = selectBySid.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) {
      cb(e);
    }
  }

  set(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie && sessionData.cookie.maxAge ? sessionData.cookie.maxAge : 24 * 60 * 60 * 1000;
      const expires = Date.now() + maxAge;
      upsert.run({ sid, expires, data: JSON.stringify(sessionData) });
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }

  destroy(sid, cb) {
    try {
      deleteBySid.run(sid);
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }

  touch(sid, sessionData, cb) {
    this.set(sid, sessionData, cb);
  }

  length(cb) {
    try {
      cb(null, countAll.get().n);
    } catch (e) {
      cb(e);
    }
  }

  clear(cb) {
    try {
      clearAll.run();
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }
}

module.exports = SqliteSessionStore;

"use strict";

require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("../src/db");

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.error("Usage : npm run set-password -- <identifiant> <nouveau_mot_de_passe>");
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error("Le mot de passe doit contenir au moins 8 caractères.");
  process.exit(1);
}

const user = db.getFirstUser();
if (!user) {
  console.error("Aucun compte trouvé dans la base de données.");
  process.exit(1);
}

const hash = bcrypt.hashSync(newPassword, 12);
db.updatePasswordHash(user.id, hash);
if (user.username !== username) {
  db.updateUsername(user.id, username);
}

console.log('Mot de passe mis à jour pour l\'identifiant "' + username + '".');

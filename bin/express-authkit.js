#!/usr/bin/env node
/**
 * Petit utilitaire en ligne de commande d'Express AuthKit.
 *
 *   npx express-authkit secret   → affiche un secret JWT aléatoire (48 octets, base64url)
 */
import { randomBytes } from "node:crypto";

const SECRET_BYTES = 48;

const USAGE = `Utilisation : express-authkit <commande>

Commandes :
  secret    Affiche un secret JWT aléatoire (${SECRET_BYTES} octets, base64url) pour AUTH_SECRET.
  help      Affiche cette aide.

Exemple :
  echo "AUTH_SECRET=$(npx express-authkit secret)" >> .env
`;

const [command] = process.argv.slice(2);

if (command === "secret") {
  process.stdout.write(`${randomBytes(SECRET_BYTES).toString("base64url")}\n`);
} else if (command === undefined || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(USAGE);
} else {
  process.stderr.write(`Commande inconnue : ${command}\n\n${USAGE}`);
  process.exitCode = 1;
}

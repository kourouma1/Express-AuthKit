#!/usr/bin/env node
/**
 * Petit utilitaire en ligne de commande d'Express AuthKit.
 *
 *   npx express-authkit secret   → affiche un secret JWT aléatoire (48 octets, base64url)
 */
import { randomBytes } from "node:crypto";

const SECRET_BYTES = 48;

const USAGE = `Usage: express-authkit <command>

Commands:
  secret    Print a random JWT secret (${SECRET_BYTES} bytes, base64url) for AUTH_SECRET.

Example:
  echo "AUTH_SECRET=$(npx express-authkit secret)" >> .env
`;

const [command] = process.argv.slice(2);

if (command === "secret") {
  process.stdout.write(`${randomBytes(SECRET_BYTES).toString("base64url")}\n`);
} else if (command === undefined || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(USAGE);
} else {
  process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
  process.exitCode = 1;
}

/**
 * Génère les déclarations TypeScript (fichiers .d.ts du dossier types/) à partir du JSDoc de src/.
 *
 * Aucun fichier TypeScript n'est écrit à la main : le code source reste en
 * JavaScript, et les types sont produits automatiquement avant chaque `npm pack`
 * ou `npm publish` (script `prepack`).
 *
 * Seule exception : la déclaration de `req.auth` pour Express. JSDoc ne sait
 * pas exprimer une augmentation de module, elle est donc ajoutée ici.
 *
 * Utilisation : npm run build:types
 */
import { execFileSync } from "node:child_process";
import { appendFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES_DIR = join(ROOT, "types");
const require = createRequire(import.meta.url);

const EXPRESS_REQUEST_AUGMENTATION = `
declare global {
  namespace Express {
    interface Request {
      /** Utilisateur authentifié. Présent après \`expressAuth.authenticate()\`. */
      auth?: import("../../core/contracts/auth-principal.js").AuthPrincipal;
    }
  }
}
`;

await rm(TYPES_DIR, { recursive: true, force: true });

const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
execFileSync(process.execPath, [tsc, "-p", join(ROOT, "tsconfig.types.json")], { stdio: "inherit" });

await appendFile(join(TYPES_DIR, "adapters", "express", "index.d.ts"), EXPRESS_REQUEST_AUGMENTATION);

console.log("✔ Déclarations TypeScript générées dans types/");

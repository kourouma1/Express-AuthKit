/**
 * Vérifie le paquet exactement comme il sera publié :
 *
 * 1. Création du tarball avec `npm pack` et contrôle des fichiers inclus.
 * 2. Installation du tarball dans un projet JavaScript vierge, puis exécution
 *    du scénario de démarrage rapide du README.
 * 3. Installation du tarball dans une copie de examples/basic-express, puis
 *    exécution de ses tests.
 *
 * Nécessite un accès réseau (ou un cache npm déjà rempli) pour installer les dépendances.
 * Utilisation : npm run test:package
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const ALLOWED_TOP_LEVEL = new Set(["package.json", "README.md", "CHANGELOG.md", "SECURITY.md", "LICENSE"]);

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" });
}

async function packAndInspect(workDir) {
  const [pack] = JSON.parse(run(NPM, ["pack", "--json", "--pack-destination", workDir], ROOT));
  const paths = pack.files.map((file) => file.path);

  for (const path of paths) {
    const allowed = path.startsWith("src/") || ALLOWED_TOP_LEVEL.has(path);
    assert.ok(allowed, `Unexpected file in the package: ${path}`);
    assert.ok(!/\.env|\.pem$|\.key$|\.ts$/.test(path), `Sensitive or forbidden file in the package: ${path}`);
  }
  for (const required of ["src/index.js", "src/adapters/express/index.js", "README.md", "LICENSE"]) {
    assert.ok(paths.includes(required), `Missing file in the package: ${required}`);
  }

  console.log(`✔ ${pack.filename}: ${paths.length} files, ${pack.size} bytes`);
  return join(workDir, pack.filename);
}

async function verifyBlankProject(workDir, tarball) {
  const projectDir = join(workDir, "blank-project");
  await cp(join(ROOT, "scripts/fixtures/blank-project"), projectDir, { recursive: true });
  run(NPM, ["install", "--no-audit", "--no-fund", tarball, "express@^5"], projectDir);
  process.stdout.write(run(process.execPath, ["consumer.js"], projectDir));
  console.log("✔ blank JavaScript project");
}

async function verifyExampleApp(workDir, tarball) {
  const exampleDir = join(workDir, "basic-express");
  await cp(join(ROOT, "examples/basic-express"), exampleDir, {
    recursive: true,
    filter: (source) => !source.includes("node_modules") && !source.endsWith("package-lock.json")
  });

  const manifestPath = join(exampleDir, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dependencies["express-authkit"] = `file:${tarball}`;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  run(NPM, ["install", "--no-audit", "--no-fund"], exampleDir);
  run(NPM, ["test"], exampleDir);
  console.log("✔ examples/basic-express against the packed tarball");
}

const workDir = await mkdtemp(join(tmpdir(), "express-authkit-verify-"));
try {
  const tarball = await packAndInspect(workDir);
  await verifyBlankProject(workDir, tarball);
  await verifyExampleApp(workDir, tarball);
  console.log("Package verification succeeded.");
} finally {
  await rm(workDir, { recursive: true, force: true });
}

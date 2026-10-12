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
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const ALLOWED_DIRECTORIES = ["src/", "bin/", "types/"];
const ALLOWED_TOP_LEVEL = new Set(["package.json", "README.md", "CHANGELOG.md", "SECURITY.md", "LICENSE"]);

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" });
}

async function packAndInspect(workDir) {
  // Les types sont générés ici, puis `npm pack` est lancé sans scripts :
  // sinon la sortie de `prepack` se mélangerait au JSON de `npm pack --json`.
  run(NPM, ["run", "build:types"], ROOT);
  const [pack] = JSON.parse(run(NPM, ["pack", "--json", "--ignore-scripts", "--pack-destination", workDir], ROOT));
  const paths = pack.files.map((file) => file.path);

  for (const path of paths) {
    const allowed = ALLOWED_DIRECTORIES.some((directory) => path.startsWith(directory)) || ALLOWED_TOP_LEVEL.has(path);
    assert.ok(allowed, `Unexpected file in the package: ${path}`);
    // Seules les déclarations générées (.d.ts) sont autorisées : aucune source TypeScript.
    const isTypeScriptSource = path.endsWith(".ts") && !path.endsWith(".d.ts");
    assert.ok(!/\.env|\.pem$|\.key$/.test(path) && !isTypeScriptSource, `Sensitive or forbidden file in the package: ${path}`);
  }
  for (const required of [
    "src/index.js",
    "src/adapters/express/index.js",
    "types/index.d.ts",
    "types/adapters/express/index.d.ts",
    "README.md",
    "LICENSE"
  ]) {
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
  await verifyReadmeQuickstart(projectDir);
  await verifyTypes(projectDir);
}

/**
 * Vérifie les types publiés comme le ferait un utilisateur de TypeScript ou
 * de VS Code : typed-consumer.js est contrôlé par tsc en mode strict.
 */
async function verifyTypes(projectDir) {
  run(NPM, ["install", "--no-audit", "--no-fund", "typescript@^7", "@types/express@^5", "@types/node@^24"], projectDir);
  const tsc = join(projectDir, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [tsc, "-p", join(projectDir, "tsconfig.json")], projectDir);
  console.log("✔ TypeScript types (strict check of a consumer file, @ts-expect-error included)");
}

/**
 * Exécute tel quel le `server.js` du « Démarrage en cinq minutes » du README,
 * avec un secret produit par `npx express-authkit secret` : la documentation
 * ne peut pas diverger de l'API sans que cette vérification échoue.
 */
async function verifyReadmeQuickstart(projectDir) {
  const readme = await readFile(join(ROOT, "README.md"), "utf8");
  const quickstart = readme.slice(readme.indexOf("## Démarrage en cinq minutes"));
  const code = /```javascript\n([\s\S]*?)```/.exec(quickstart)?.[1];
  assert.ok(code, "README quick-start code block not found");
  // Seul le port est remplacé, pour ne pas entrer en conflit avec un service local.
  const port = await findFreePort();
  assert.ok(code.includes("3000"), "README quick-start is expected to listen on port 3000");
  await writeFile(join(projectDir, "server.js"), code.replaceAll("3000", String(port)));
  const baseUrl = `http://127.0.0.1:${port}`;

  const secret = run(process.platform === "win32" ? "npx.cmd" : "npx", ["express-authkit", "secret"], projectDir).trim();
  const server = spawn(process.execPath, ["server.js"], {
    cwd: projectDir,
    env: { ...process.env, AUTH_SECRET: secret },
    stdio: ["ignore", "pipe", "inherit"]
  });
  try {
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error("README server did not start")), 20_000);
      server.stdout.on("data", (chunk) => {
        if (String(chunk).includes(`http://localhost:${port}`)) {
          clearTimeout(timer);
          resolveReady();
        }
      });
      server.once("exit", (code) => reject(new Error(`README server exited with code ${code}`)));
    });

    const login = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "example-password" })
    });
    assert.equal(login.status, 200, "README login failed");
    const { accessToken } = await login.json();

    const profile = await fetch(`${baseUrl}/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
    assert.deepEqual(await profile.json(), { userId: "1" });
    assert.equal((await fetch(`${baseUrl}/profile`)).status, 401);
  } finally {
    server.kill();
  }
  console.log("✔ README quick start (copied verbatim) and npx express-authkit secret");
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

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
    probe.once("error", reject);
  });
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

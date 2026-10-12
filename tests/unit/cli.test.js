import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveJwtOptions } from "../../src/config/jwt-options.js";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../bin/express-authkit.js");

describe("CLI express-authkit", () => {
  it("prints a random secret accepted by the configuration", () => {
    const first = execFileSync(process.execPath, [CLI, "secret"], { encoding: "utf8" }).trim();
    const second = execFileSync(process.execPath, [CLI, "secret"], { encoding: "utf8" }).trim();
    assert.match(first, /^[A-Za-z0-9_-]{64}$/);
    assert.notEqual(first, second);
    assert.doesNotThrow(() => resolveJwtOptions({ secret: first, issuer: "i", audience: "a", algorithm: "HS384" }));
  });

  it("prints usage without arguments and fails on unknown commands", () => {
    assert.match(execFileSync(process.execPath, [CLI], { encoding: "utf8" }), /Utilisation : express-authkit/);
    const unknown = spawnSync(process.execPath, [CLI, "nope"], { encoding: "utf8" });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Commande inconnue : nope/);
  });
});

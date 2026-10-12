import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { resolveJwtOptions } from "../../src/config/jwt-options.js";
import { resolvePasswordOptions } from "../../src/config/password-options.js";
import { ConfigurationError, createAuthKit } from "../../src/index.js";
import { FAST_ARGON2, createInMemoryUserRepository, jwtOptions } from "../helpers/fixtures.js";

const isConfigurationError = (pattern) => (error) =>
  error instanceof ConfigurationError && error.code === "INVALID_CONFIGURATION" && pattern.test(error.message);

describe("resolveJwtOptions", () => {
  it("applies secure defaults", () => {
    const resolved = resolveJwtOptions(jwtOptions());
    assert.equal(resolved.algorithm, "HS256");
    assert.equal(resolved.expiresInSeconds, 900);
    assert.equal(resolved.clockToleranceSeconds, 0);
    assert.ok(resolved.key instanceof Uint8Array);
    assert.ok(Object.isFrozen(resolved));
  });

  it("requires a secret", () => {
    for (const secret of [undefined, null, ""]) {
      assert.throws(() => resolveJwtOptions(jwtOptions({ secret })), isConfigurationError(/« jwt.secret » est obligatoire.*npx express-authkit secret/));
    }
  });

  it("rejects secrets that are too short for the algorithm", () => {
    const secret32 = randomBytes(24).toString("base64url"); // 32 caractères
    assert.doesNotThrow(() => resolveJwtOptions(jwtOptions({ secret: secret32 })));
    assert.throws(
      () => resolveJwtOptions(jwtOptions({ secret: randomBytes(16).toString("base64url") })),
      isConfigurationError(/au moins 32 octets/)
    );
    assert.throws(
      () => resolveJwtOptions(jwtOptions({ secret: secret32, algorithm: "HS512" })),
      isConfigurationError(/au moins 64 octets/)
    );
  });

  it("rejects placeholder and repetitive secrets", () => {
    const weakSecrets = [
      "please-change-me-before-going-to-production",
      "my-super-secret-jwt-key-for-the-application",
      "a".repeat(64),
      "abcdefghijk".repeat(5),
      "0123456789".repeat(4)
    ];
    for (const secret of weakSecrets) {
      assert.throws(() => resolveJwtOptions(jwtOptions({ secret })), ConfigurationError, secret);
    }
  });

  it("accepts a random Uint8Array secret and copies it", () => {
    const secret = new Uint8Array(randomBytes(32));
    const resolved = resolveJwtOptions(jwtOptions({ secret }));
    secret.fill(0);
    assert.notDeepEqual(resolved.key, secret);
  });

  it("rejects non-string secrets and repetitive byte secrets", () => {
    assert.throws(() => resolveJwtOptions(jwtOptions({ secret: 12345 })), isConfigurationError(/un texte ou un Uint8Array/));
    assert.throws(() => resolveJwtOptions(jwtOptions({ secret: new Uint8Array(64) })), isConfigurationError(/trop répétitive/));
  });

  it("only allows HMAC algorithms from the allowlist", () => {
    for (const algorithm of ["none", "RS256", "hs256", "HS1"]) {
      assert.throws(() => resolveJwtOptions(jwtOptions({ algorithm })), isConfigurationError(/doit valoir l’une de ces valeurs : HS256, HS384, HS512/));
    }
  });

  it("requires issuer and audience", () => {
    assert.throws(() => resolveJwtOptions(jwtOptions({ issuer: undefined })), isConfigurationError(/jwt.issuer/));
    assert.throws(() => resolveJwtOptions(jwtOptions({ audience: "  " })), isConfigurationError(/jwt.audience/));
    assert.throws(() => resolveJwtOptions(jwtOptions({ issuer: "x".repeat(257) })), isConfigurationError(/ne doit pas dépasser 256 caractères/));
  });

  it("bounds the token lifetime and the clock tolerance", () => {
    for (const expiresInSeconds of [0, 10, 86_401, 1.5, "900"]) {
      assert.throws(() => resolveJwtOptions(jwtOptions({ expiresInSeconds })), isConfigurationError(/expiresInSeconds/));
    }
    assert.throws(() => resolveJwtOptions(jwtOptions({ clockToleranceSeconds: 120 })), isConfigurationError(/clockTolerance/));
  });

  it("rejects unknown keys to catch typos", () => {
    assert.throws(() => resolveJwtOptions(jwtOptions({ expiresIn: "1h" })), isConfigurationError(/Option inconnue dans « jwt » : expiresIn/));
  });
});

describe("resolvePasswordOptions", () => {
  it("defaults to RFC 9106 Argon2id parameters", () => {
    assert.deepEqual({ ...resolvePasswordOptions() }, { memoryCost: 65_536, timeCost: 3, parallelism: 4 });
  });

  it("refuses parameters below the OWASP floor", () => {
    assert.throws(() => resolvePasswordOptions({ memoryCost: 4096 }), isConfigurationError(/memoryCost/));
    assert.throws(() => resolvePasswordOptions({ timeCost: 1 }), isConfigurationError(/timeCost/));
    assert.throws(() => resolvePasswordOptions({ parallelism: 0 }), isConfigurationError(/parallelism/));
    assert.throws(() => resolvePasswordOptions({ saltLength: 4 }), isConfigurationError(/Option inconnue/));
  });
});

describe("createAuthKit options", () => {
  const users = createInMemoryUserRepository();

  it("requires an options object and a repository", () => {
    assert.throws(() => createAuthKit(), isConfigurationError(/« createAuthKit\(options\) » doit être un objet simple/));
    assert.throws(() => createAuthKit({ jwt: jwtOptions() }), isConfigurationError(/L’option « users » est obligatoire/));
  });

  it("requires jwt options unless a token provider is injected", () => {
    assert.throws(() => createAuthKit({ users }), isConfigurationError(/L’option « jwt » est obligatoire/));
  });

  it("refuses ambiguous combinations of options and providers", () => {
    const token = { issue: async () => ({}), verify: async () => ({}) };
    const password = { hash: async () => "", verify: async () => false };
    assert.throws(() => createAuthKit({ users, jwt: jwtOptions(), providers: { token } }), isConfigurationError(/mais pas les deux/));
    assert.throws(
      () => createAuthKit({ users, jwt: jwtOptions(), password: FAST_ARGON2, providers: { password } }),
      isConfigurationError(/mais pas les deux/)
    );
  });

  it("rejects unknown top-level and provider keys", () => {
    assert.throws(() => createAuthKit({ users, jwt: jwtOptions(), secret: "x" }), isConfigurationError(/Option inconnue/));
    assert.throws(
      () => createAuthKit({ users, jwt: jwtOptions(), providers: { cache: {} } }),
      isConfigurationError(/Option inconnue/)
    );
  });

  it("returns a frozen engine exposing the public API", () => {
    const auth = createAuthKit({ users, jwt: jwtOptions(), password: FAST_ARGON2 });
    assert.ok(Object.isFrozen(auth));
    assert.ok(Object.isFrozen(auth.password));
    assert.deepEqual(Object.keys(auth).sort(), ["login", "logout", "password", "refresh", "revokeAllSessions", "verifyAccessToken"]);
    assert.deepEqual(Object.keys(auth.password).sort(), ["hash", "verify"]);
  });
});

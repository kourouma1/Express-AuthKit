import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  AUDIT_EVENTS,
  ConfigurationError,
  DependencyFailureError,
  InvalidInputError,
  createArgon2PasswordProvider,
  createAuthKit,
  createInMemoryRefreshTokenStore,
  isPasswordCompromised
} from "../../src/index.js";
import { FAST_ARGON2, TEST_PASSWORD, createInMemoryUserRepository, jwtOptions } from "../helpers/fixtures.js";

/** Moteur réel qui enregistre tous ses événements d'audit. */
async function setup(extra = {}) {
  const events = [];
  const users = createInMemoryUserRepository();
  const auth = createAuthKit({
    users,
    jwt: jwtOptions(),
    password: FAST_ARGON2,
    refreshTokens: { store: createInMemoryRefreshTokenStore() },
    loginAttempts: { maxFailuresPerIdentifier: 3 },
    audit: (event) => events.push(event),
    ...extra
  });
  users.users.set("u1", { id: "u1", email: "alice@example.test", passwordHash: await auth.password.hash(TEST_PASSWORD), isActive: true });
  users.users.set("u2", { id: "u2", email: "bob@example.test", passwordHash: await auth.password.hash(TEST_PASSWORD), isActive: false });
  return { auth, users, events, types: () => events.map((e) => e.type) };
}

describe("audit events", () => {
  it("reports successful and failed logins with their reason, never secrets", async () => {
    const { auth, events } = await setup();
    await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD }, { clientKey: "203.0.113.7" });
    await assert.rejects(auth.login({ identifier: "alice@example.test", password: "wrong" }));
    await assert.rejects(auth.login({ identifier: "ghost@example.test", password: "wrong" }));
    await assert.rejects(auth.login({ identifier: "bob@example.test", password: TEST_PASSWORD }));

    const [ok, wrong, ghost, disabled] = events;
    assert.deepEqual({ type: ok.type, userId: ok.userId, identifier: ok.identifier, client: ok.client }, { type: "login.succeeded", userId: "u1", identifier: "alice@example.test", client: "203.0.113.7" });
    assert.deepEqual([wrong.type, wrong.reason, wrong.userId], ["login.failed", "INVALID_PASSWORD", "u1"]);
    assert.deepEqual([ghost.type, ghost.reason, ghost.userId], ["login.failed", "USER_NOT_FOUND", undefined]);
    assert.deepEqual([disabled.type, disabled.reason, disabled.userId], ["login.failed", "ACCOUNT_DISABLED", "u2"]);
    for (const event of events) {
      assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(Object.isFrozen(event));
      const serialized = JSON.stringify(event);
      assert.equal(serialized.includes(TEST_PASSWORD) || serialized.includes("wrong") || serialized.includes("argon2"), false);
    }
  });

  it("reports account locks and blocked attempts", async () => {
    const { auth, types, events } = await setup();
    for (let i = 0; i < 3; i++) await assert.rejects(auth.login({ identifier: "alice@example.test", password: "wrong" }));
    await assert.rejects(auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD }));
    assert.deepEqual(types(), ["login.failed", "login.failed", "login.failed", "account.locked", "login.blocked"]);
    assert.equal(events.at(-1).scope, "identifier");
    assert.ok(events.at(-1).retryAfterSeconds > 0);
  });

  it("reports refresh, theft detection, logout and revocations", async () => {
    const { auth, types, events } = await setup();
    const first = await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD });
    const second = await auth.refresh(first.refreshToken);
    await assert.rejects(auth.refresh(first.refreshToken));
    const third = await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD });
    await auth.logout(third.refreshToken);
    await auth.revokeAllSessions("u1");
    await assert.rejects(auth.verifyAccessToken("not-a-token"));
    assert.ok(second.accessToken);
    assert.deepEqual(types(), [
      AUDIT_EVENTS.LOGIN_SUCCEEDED, AUDIT_EVENTS.REFRESH_SUCCEEDED, AUDIT_EVENTS.REFRESH_REUSE_DETECTED,
      AUDIT_EVENTS.LOGIN_SUCCEEDED, AUDIT_EVENTS.LOGOUT, AUDIT_EVENTS.SESSIONS_REVOKED, AUDIT_EVENTS.TOKEN_REJECTED
    ]);
    assert.equal(events[2].userId, "u1");
    assert.equal(events[4].userId, "u1");
  });

  it("never blocks authentication when the audit hook fails, and reports it", async () => {
    const warnings = [];
    const onWarning = (w) => warnings.push(w);
    process.on("warning", onWarning);
    try {
      const sync = await setup({ audit: () => { throw new Error("log server down"); } });
      assert.ok((await sync.auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD })).accessToken);
      const async_ = await setup({ audit: async () => { throw new Error("log server down"); } });
      assert.ok((await async_.auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD })).accessToken);
      await new Promise((r) => setImmediate(r));
    } finally {
      process.off("warning", onWarning);
    }
    const ours = warnings.filter((w) => w.code === "EXPRESS_AUTHKIT_AUDIT");
    assert.equal(ours.length, 2);
    assert.match(ours[0].message, /gestionnaire d’audit/);
  });

  it("rejects a non-function audit option", () => {
    assert.throws(() => createAuthKit({ users: createInMemoryUserRepository(), jwt: jwtOptions(), audit: "console" }), ConfigurationError);
  });
});

describe("automatic password hash upgrade", () => {
  async function legacySetup({ withUpdate = true } = {}) {
    const events = [];
    const updates = [];
    const repo = createInMemoryUserRepository();
    // Hash « ancien » : produit avec les coûts minimaux, alors que le moteur utilise les valeurs par défaut.
    const legacyHash = await createArgon2PasswordProvider(FAST_ARGON2).hash(TEST_PASSWORD);
    repo.users.set("u1", { id: "u1", email: "alice@example.test", passwordHash: legacyHash, isActive: true });
    const users = withUpdate
      ? { ...repo, async updatePasswordHash(id, hash) { updates.push(hash); repo.users.get(id).passwordHash = hash; } }
      : repo;
    const auth = createAuthKit({ users, jwt: jwtOptions(), audit: (e) => events.push(e) });
    return { auth, events, updates, legacyHash, repo };
  }

  it("re-hashes outdated hashes at login and stores the new one", async () => {
    const { auth, events, updates, legacyHash, repo } = await legacySetup();
    await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD });
    assert.equal(updates.length, 1);
    assert.match(updates[0], /^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
    assert.notEqual(repo.users.get("u1").passwordHash, legacyHash);
    assert.ok(events.some((e) => e.type === "password.rehashed" && e.userId === "u1"));
    // Le nouveau hash est à jour : pas de nouveau calcul à la connexion suivante.
    await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD });
    assert.equal(updates.length, 1);
  });

  it("does nothing when the repository cannot store hashes", async () => {
    const { auth, events } = await legacySetup({ withUpdate: false });
    assert.ok((await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD })).accessToken);
    assert.equal(events.some((e) => e.type.startsWith("password.")), false);
  });

  it("never blocks the login when the update fails, and audits it", async () => {
    const events = [];
    const repo = createInMemoryUserRepository();
    repo.users.set("u1", { id: "u1", email: "alice@example.test", passwordHash: await createArgon2PasswordProvider(FAST_ARGON2).hash(TEST_PASSWORD), isActive: true });
    const auth = createAuthKit({
      users: { ...repo, updatePasswordHash: async () => { throw new Error("read-only replica"); } },
      jwt: jwtOptions(),
      audit: (e) => events.push(e)
    });
    assert.ok((await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD })).accessToken);
    const failed = events.find((e) => e.type === "password.rehash_failed");
    assert.ok(failed);
    // Seuls le code et la dépendance sont transmis, jamais l'erreur d'origine (requête SQL, hash…).
    assert.deepEqual(failed.error, { code: "DEPENDENCY_FAILURE", dependency: "UserRepository.updatePasswordHash" });
    assert.equal(JSON.stringify(failed).includes("read-only replica"), false);
  });
});

describe("isPasswordCompromised", () => {
  const sha1 = (s) => createHash("sha1").update(s).digest("hex").toUpperCase();
  const fakeFetch = (lines, calls = []) => async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => lines.join("\r\n") };
  };

  it("sends only the first 5 characters of the SHA-1 and compares locally", async () => {
    const hash = sha1("password123");
    const calls = [];
    const fetch = fakeFetch([`${hash.slice(5)}:24230577`, "0018A45C4D1DEF81644B54AB7F969B88D65:0"], calls);
    assert.equal(await isPasswordCompromised("password123", { fetch }), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    assert.equal(calls[0].url.includes(hash.slice(5)), false);
    assert.equal(calls[0].init.headers["Add-Padding"], "true");
  });

  it("returns false for unknown passwords and ignores padding lines", async () => {
    const hash = sha1("a long and unique passphrase");
    const fetch = fakeFetch([`${hash.slice(5)}:0`, "0018A45C4D1DEF81644B54AB7F969B88D65:12"]);
    assert.equal(await isPasswordCompromised("a long and unique passphrase", { fetch }), false);
  });

  it("reports service failures as DependencyFailureError", async () => {
    const fetch = async () => ({ ok: false, status: 503, text: async () => "" });
    await assert.rejects(isPasswordCompromised("x", { fetch }), (e) => e instanceof DependencyFailureError && e.dependency === "PwnedPasswords.range");
    await assert.rejects(isPasswordCompromised("x", { fetch: async () => { throw new TypeError("fetch failed"); } }), DependencyFailureError);
  });

  it("validates the password", async () => {
    await assert.rejects(isPasswordCompromised(""), InvalidInputError);
    await assert.rejects(isPasswordCompromised("x".repeat(1025)), InvalidInputError);
  });
});

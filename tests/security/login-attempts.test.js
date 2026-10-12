import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConfigurationError,
  ContractViolationError,
  DependencyFailureError,
  InvalidCredentialsError,
  TooManyAttemptsError,
  createAuthKit,
  createInMemoryAttemptStore
} from "../../src/index.js";
import { FAST_ARGON2, TEST_PASSWORD, createInMemoryUserRepository, jwtOptions } from "../helpers/fixtures.js";

/**
 * Moteur réel avec un utilisateur actif ; le stockage des compteurs est observé
 * pour vérifier qu'aucune donnée personnelle n'y est écrite.
 */
async function setup(loginAttempts = {}) {
  const store = createInMemoryAttemptStore();
  const keys = new Set();
  const observed = {
    hit: (key, w) => (keys.add(key), store.hit(key, w)),
    reset: (key) => store.reset(key)
  };
  const users = createInMemoryUserRepository();
  const auth = createAuthKit({
    users,
    jwt: jwtOptions(),
    password: FAST_ARGON2,
    loginAttempts: loginAttempts === false ? false : { store: observed, ...loginAttempts }
  });
  users.users.set("u1", { id: "u1", email: "alice@example.test", passwordHash: await auth.password.hash(TEST_PASSWORD), isActive: true });
  const login = (identifier, password = TEST_PASSWORD, clientKey) => auth.login({ identifier, password }, { clientKey });
  return { auth, login, keys };
}

const isBlocked = (scope) => (error) => {
  assert.ok(error instanceof TooManyAttemptsError, `attendu TooManyAttemptsError, reçu ${error?.name}`);
  assert.equal(error.code, "TOO_MANY_ATTEMPTS");
  assert.equal(error.scope, scope);
  assert.ok(error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 900);
  assert.match(error.message, /^Trop de tentatives de connexion\. Réessayez dans \d+ minutes?\.$/);
  return true;
};

describe("login attempt limiting (enabled by default)", () => {
  it("locks an account after 5 failures, even with the right password", async () => {
    const { login } = await setup();
    for (let i = 0; i < 5; i++) {
      await assert.rejects(login("alice@example.test", "wrong"), InvalidCredentialsError);
    }
    await assert.rejects(login("alice@example.test", "wrong"), isBlocked("identifier"));
    await assert.rejects(login("alice@example.test"), isBlocked("identifier"));
  });

  it("treats identifier case and spaces as the same account", async () => {
    const { login } = await setup({ maxFailuresPerIdentifier: 2 });
    await assert.rejects(login("Alice@Example.test", "wrong"), InvalidCredentialsError);
    await assert.rejects(login(" alice@example.test ", "wrong"), InvalidCredentialsError);
    await assert.rejects(login("ALICE@EXAMPLE.TEST"), TooManyAttemptsError);
  });

  it("locks unknown accounts exactly like real ones (no account enumeration)", async () => {
    const { login } = await setup({ maxFailuresPerIdentifier: 3 });
    for (const identifier of ["alice@example.test", "ghost@example.test"]) {
      for (let i = 0; i < 3; i++) {
        await assert.rejects(login(identifier, "wrong"), InvalidCredentialsError);
      }
      await assert.rejects(login(identifier, "wrong"), isBlocked("identifier"));
    }
  });

  it("resets the counter after a successful login", async () => {
    const { login } = await setup({ maxFailuresPerIdentifier: 3 });
    await assert.rejects(login("alice@example.test", "wrong"));
    await assert.rejects(login("alice@example.test", "wrong"));
    assert.ok((await login("alice@example.test")).accessToken);
    await assert.rejects(login("alice@example.test", "wrong"), InvalidCredentialsError);
    await assert.rejects(login("alice@example.test", "wrong"), InvalidCredentialsError);
    assert.ok((await login("alice@example.test")).accessToken);
  });

  it("does not let one locked account block the others", async () => {
    const { login } = await setup({ maxFailuresPerIdentifier: 2 });
    await assert.rejects(login("ghost@example.test", "wrong"));
    await assert.rejects(login("ghost@example.test", "wrong"));
    await assert.rejects(login("ghost@example.test"), TooManyAttemptsError);
    assert.ok((await login("alice@example.test")).accessToken);
  });

  it("limits attempts per client (IP), across different accounts", async () => {
    const { login } = await setup({ maxAttemptsPerClient: 4 });
    for (let i = 0; i < 4; i++) {
      await assert.rejects(login(`victim${i}@example.test`, "wrong", "203.0.113.7"), InvalidCredentialsError);
    }
    await assert.rejects(login("alice@example.test", TEST_PASSWORD, "203.0.113.7"), isBlocked("client"));
    // Un autre client n'est pas concerné.
    assert.ok((await login("alice@example.test", TEST_PASSWORD, "198.51.100.1")).accessToken);
  });

  it("unlocks once the window has passed", async () => {
    const { login } = await setup({ maxFailuresPerIdentifier: 2, windowSeconds: 60 });
    await assert.rejects(login("alice@example.test", "wrong"));
    await assert.rejects(login("alice@example.test", "wrong"));
    await assert.rejects(login("alice@example.test"), TooManyAttemptsError);
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      assert.ok((await login("alice@example.test")).accessToken);
    } finally {
      Date.now = realNow;
    }
  });

  it("never stores identifiers or IP addresses in clear", async () => {
    const { login, keys } = await setup();
    await assert.rejects(login("alice@example.test", "wrong", "203.0.113.7"));
    assert.ok(keys.size >= 2);
    for (const key of keys) {
      assert.match(key, /^login:(id|client):[0-9a-f]{64}$/);
      assert.equal(key.includes("alice") || key.includes("203.0.113.7"), false);
    }
  });

  it("can be disabled explicitly", async () => {
    const { login } = await setup(false);
    for (let i = 0; i < 8; i++) {
      await assert.rejects(login("alice@example.test", "wrong"), InvalidCredentialsError);
    }
    assert.ok((await login("alice@example.test")).accessToken);
  });

  it("validates its options and store at startup", () => {
    const users = createInMemoryUserRepository();
    const make = (loginAttempts) => () => createAuthKit({ users, jwt: jwtOptions(), loginAttempts });
    assert.throws(make({ maxFailuresPerIdentifier: 0 }), ConfigurationError);
    assert.throws(make({ windowSeconds: 10 }), ConfigurationError);
    assert.throws(make({ maxAttempts: 5 }), ConfigurationError);
    assert.throws(make({ store: { hit() {} } }), ContractViolationError);
  });

  it("fails closed when the store is down or returns garbage", async () => {
    const users = createInMemoryUserRepository();
    const down = createAuthKit({
      users,
      jwt: jwtOptions(),
      loginAttempts: { store: { hit: async () => { throw new Error("redis down"); }, reset: async () => {} } }
    });
    await assert.rejects(down.login({ identifier: "a@b.c", password: "x" }), (e) => e instanceof DependencyFailureError && e.dependency === "AttemptStore.hit");
    const make = (hit) => createAuthKit({ users, jwt: jwtOptions(), loginAttempts: { store: { hit, reset: async () => {} } } });
    const garbage = [
      async () => "x",
      async () => null,
      async () => ({ count: 0, resetAt: Date.now() / 1000 + 60 }),
      // Millisecondes au lieu de secondes : bloquerait le compte pendant des siècles.
      async () => ({ count: 1, resetAt: Date.now() + 60_000 })
    ];
    for (const hit of garbage) {
      await assert.rejects(make(hit).login({ identifier: "a@b.c", password: "x" }), ContractViolationError);
    }
  });
});

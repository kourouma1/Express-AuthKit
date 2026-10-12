import assert from "node:assert/strict";
import { connect } from "node:net";
import { describe, it } from "node:test";

import express from "express";

import { createExpressAuth } from "../../src/adapters/express/index.js";
import {
  ConfigurationError,
  ContractViolationError,
  DependencyFailureError,
  InvalidCredentialsError,
  TooManyAttemptsError,
  createArgon2PasswordProvider,
  createAuthKit,
  createInMemoryAttemptStore,
  createInMemoryRefreshTokenStore,
  isPasswordCompromised
} from "../../src/index.js";
import { FAST_ARGON2, TEST_PASSWORD, createInMemoryUserRepository, jwtOptions } from "../helpers/fixtures.js";
import { startServer } from "../helpers/http.js";

/** Moteur réel avec un utilisateur actif. */
async function setup(options = {}) {
  const users = createInMemoryUserRepository();
  const auth = createAuthKit({ users, jwt: jwtOptions(), password: FAST_ARGON2, ...options });
  users.users.set("u1", { id: "u1", email: "alice@example.test", passwordHash: await auth.password.hash(TEST_PASSWORD), isActive: true });
  return { auth, users };
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

describe("login attempt limiting under concurrency", () => {
  it("never lets parallel requests exceed the per-account limit, without client key", async () => {
    let verifications = 0;
    const { auth } = await setup();
    const counting = createAuthKit({
      users: createInMemoryUserRepository([{ id: "u1", email: "alice@example.test", passwordHash: await auth.password.hash(TEST_PASSWORD), isActive: true }]),
      jwt: jwtOptions(),
      providers: {
        password: {
          hash: (p) => auth.password.hash(p),
          verify: async (p, h) => (verifications++, auth.password.verify(p, h))
        }
      }
    });
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => counting.login({ identifier: "alice@example.test", password: "wrong" }))
    );
    const reasons = results.map((r) => /** @type {PromiseRejectedResult} */ (r).reason);
    assert.equal(reasons.filter((e) => e instanceof InvalidCredentialsError).length, 5);
    assert.equal(reasons.filter((e) => e instanceof TooManyAttemptsError).length, 45);
    assert.equal(verifications, 5, "seules 5 vérifications Argon2id doivent avoir lieu");
  });

  it("never lets parallel requests from many IP addresses exceed the per-account limit", async () => {
    const { auth } = await setup();
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) => auth.login({ identifier: "alice@example.test", password: "wrong" }, { clientKey: `198.51.100.${i}` }))
    );
    const reasons = results.map((r) => /** @type {PromiseRejectedResult} */ (r).reason);
    assert.equal(reasons.filter((e) => e instanceof InvalidCredentialsError).length, 5);
  });

  it("does not let a blocked client advance the counter of the targeted account", async () => {
    const { auth } = await setup({ loginAttempts: { maxAttemptsPerClient: 1 } });
    await assert.rejects(auth.login({ identifier: "alice@example.test", password: "wrong" }, { clientKey: "203.0.113.1" }), InvalidCredentialsError);
    for (let i = 0; i < 10; i++) {
      await assert.rejects(auth.login({ identifier: "alice@example.test", password: "wrong" }, { clientKey: "203.0.113.1" }), TooManyAttemptsError);
    }
    // Le compte n'a subi qu'un échec : son propriétaire se connecte depuis une autre adresse.
    assert.ok((await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD }, { clientKey: "198.51.100.9" })).accessToken);
  });

  it("shares the counter between Unicode-compatible forms of an identifier", async () => {
    const { auth } = await setup({ loginAttempts: { maxFailuresPerIdentifier: 2 } });
    await assert.rejects(auth.login({ identifier: "ａｌｉｃｅ@example.test", password: "wrong" }), InvalidCredentialsError);
    await assert.rejects(auth.login({ identifier: "ALICE@example.test", password: "wrong" }), InvalidCredentialsError);
    await assert.rejects(auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD }), TooManyAttemptsError);
  });

  it("rejects a null store instead of silently using memory", () => {
    assert.throws(() => createAuthKit({ users: createInMemoryUserRepository(), jwt: jwtOptions(), loginAttempts: { store: null } }), ConfigurationError);
  });
});

describe("refresh token rotation", () => {
  it("reports a repository returning another user as a contract violation, and closes the session", async () => {
    const { auth, users } = await setup({ refreshTokens: { store: createInMemoryRefreshTokenStore() }, loginAttempts: false });
    const { refreshToken } = await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD });
    const findById = users.findById.bind(users);
    users.findById = async (id) => ({ ...(await findById(id)), id: "someone-else" });
    await assert.rejects(auth.refresh(refreshToken), ContractViolationError);
    users.findById = findById;
    await assert.rejects(auth.refresh(refreshToken), (e) => e.reason === "REFRESH_TOKEN_UNKNOWN");
  });
});

describe("in-memory attempt store", () => {
  it("keeps memory bounded by forgetting the oldest counters", async () => {
    const store = createInMemoryAttemptStore({ maxEntries: 3 });
    for (const key of ["a", "b", "c", "d"]) await store.hit(key, 60);
    assert.equal((await store.hit("a", 60)).count, 1, "« a » a été oublié pour faire place à « d »");
    assert.equal((await store.hit("d", 60)).count, 2);
  });

  it("purges expired counters and restarts the window", async () => {
    const store = createInMemoryAttemptStore();
    const realNow = Date.now;
    try {
      assert.equal((await store.hit("k", 60)).count, 1);
      assert.equal((await store.hit("k", 60)).count, 2);
      Date.now = () => realNow() + 61_000;
      assert.equal((await store.hit("k", 60)).count, 1);
    } finally {
      Date.now = realNow;
    }
  });

  it("validates its options", () => {
    assert.throws(() => createInMemoryAttemptStore({ maxEntries: 0 }), ConfigurationError);
    assert.throws(() => createInMemoryAttemptStore({ max: 10 }), ConfigurationError);
  });
});

describe("audit hook robustness", () => {
  for (const [label, hook] of [
    ["throws a value that cannot be converted to text", () => { throw Object.create(null); }],
    ["returns a thenable that rejects", () => ({ then: (_resolve, reject) => reject(Object.create(null)) })],
    ["returns an object whose then getter throws", () => ({ get then() { throw new Error("boom"); } })]
  ]) {
    it(`keeps authenticating and counting failures when the hook ${label}`, async () => {
      const onWarning = () => {};
      process.on("warning", onWarning);
      try {
        const { auth } = await setup({ audit: hook, loginAttempts: { maxFailuresPerIdentifier: 2 } });
        assert.ok((await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD })).accessToken);
        await assert.rejects(auth.login({ identifier: "alice@example.test", password: "wrong" }), InvalidCredentialsError);
        await assert.rejects(auth.login({ identifier: "alice@example.test", password: "wrong" }), InvalidCredentialsError);
        await assert.rejects(auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD }), TooManyAttemptsError);
        await nextTick();
      } finally {
        process.off("warning", onWarning);
      }
    });
  }

  it("reports refresh.rejected for unknown refresh tokens", async () => {
    const events = [];
    const { auth } = await setup({ refreshTokens: { store: createInMemoryRefreshTokenStore() }, audit: (e) => events.push(e) });
    await assert.rejects(auth.refresh("x".repeat(43)));
    assert.deepEqual(events.map((e) => [e.type, e.reason]), [["refresh.rejected", "REFRESH_TOKEN_UNKNOWN"]]);
  });

  it("warns about a failed hash upgrade even without an audit hook", async () => {
    const repo = createInMemoryUserRepository();
    repo.users.set("u1", { id: "u1", email: "alice@example.test", passwordHash: await createArgon2PasswordProvider(FAST_ARGON2).hash(TEST_PASSWORD), isActive: true });
    const auth = createAuthKit({ users: { ...repo, updatePasswordHash: async () => { throw new Error("read-only"); } }, jwt: jwtOptions() });
    const warnings = [];
    const onWarning = (w) => warnings.push(w);
    process.on("warning", onWarning);
    try {
      assert.ok((await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD })).accessToken);
      await nextTick();
    } finally {
      process.off("warning", onWarning);
    }
    assert.ok(warnings.some((w) => w.code === "EXPRESS_AUTHKIT_REHASH"));
  });
});

describe("Argon2id hash upgrade policy", () => {
  it("never downgrades a hash when the configured costs are lowered", async () => {
    const strong = await createArgon2PasswordProvider().hash(TEST_PASSWORD);
    const weak = await createArgon2PasswordProvider(FAST_ARGON2).hash(TEST_PASSWORD);
    assert.equal(createArgon2PasswordProvider(FAST_ARGON2).needsRehash(strong), false);
    assert.equal(createArgon2PasswordProvider().needsRehash(weak), true);
    assert.equal(createArgon2PasswordProvider().needsRehash(strong), false);
    // Paramètres dans un autre ordre, ancienne version, hash illisible, autre algorithme.
    assert.equal(createArgon2PasswordProvider().needsRehash("$argon2id$v=19$t=3,p=4,m=1024$c2FsdA$aGFzaA"), true);
    assert.equal(createArgon2PasswordProvider().needsRehash("$argon2id$v=16$m=65536,t=3,p=4$c2FsdA$aGFzaA"), true);
    assert.equal(createArgon2PasswordProvider().needsRehash("$argon2id$garbage"), false);
    assert.equal(createArgon2PasswordProvider().needsRehash("$2b$10$abcdefghijklmnopqrstuv"), true);
  });
});

describe("JWT secret checks", () => {
  const make = (secret) => () => createAuthKit({ users: createInMemoryUserRepository(), jwt: jwtOptions({ secret }) });

  it("applies the placeholder and repetition checks to byte secrets too", () => {
    assert.throws(make(Buffer.from("0123456789abcdef0123456789abcdef")), ConfigurationError);
    assert.throws(make(Buffer.from("changeme-k9#Lw2!qZ7@rT4$vX1^bN8&mC5")), ConfigurationError);
  });

  it("rejects secrets with surrounding whitespace (Windows line endings in .env)", () => {
    const secret = "k9#Lw2!qZ7@rT4$vX1^bN8&mC5*pD3(fG6)hJ0_sA";
    assert.doesNotThrow(make(secret));
    assert.throws(make(`${secret}\r`), /espace ou un retour à la ligne/);
    assert.throws(make(` ${secret}`), ConfigurationError);
  });
});

describe("isPasswordCompromised response validation", () => {
  const respond = (body, status = 200) => async () => ({ ok: status < 400, status, text: async () => body });

  it("never reads an invalid answer as « not compromised »", async () => {
    for (const body of ["", "<html>Portail Wi-Fi</html>", "OK", "x".repeat(300 * 1024)]) {
      await assert.rejects(isPasswordCompromised("hunter2", { fetch: respond(body) }), DependencyFailureError);
    }
  });

  it("accepts lowercase hexadecimal suffixes and a null options object", async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const body = "1e4c9b93f3f0682250b6cf8331b7ee68fd8:3730471\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0";
    assert.equal(await isPasswordCompromised("password", { fetch: respond(body) }), true);
    await assert.rejects(isPasswordCompromised("", null), /password/);
  });
});

describe("Express adapter hardening", () => {
  it("answers 429 with Retry-After through errorHandler() too", async () => {
    const { auth } = await setup({ loginAttempts: { maxFailuresPerIdentifier: 1 } });
    const expressAuth = createExpressAuth(auth);
    const app = express();
    app.use(express.json());
    app.post("/login", async (req, res, next) => {
      try {
        res.json(await auth.login(req.body));
      } catch (error) {
        next(error);
      }
    });
    app.use(expressAuth.errorHandler());
    const server = await startServer(app);
    try {
      const body = { identifier: "alice@example.test", password: "wrong" };
      assert.equal((await server.request("/login", { method: "POST", body })).status, 401);
      const blocked = await server.request("/login", { method: "POST", body });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    } finally {
      await server.close();
    }
  });

  it("does no work for login requests whose connection is already closed", async () => {
    let logins = 0;
    const { auth } = await setup();
    const counted = { ...auth, login: (...args) => (logins++, auth.login(...args)) };
    let bodyRead;
    const bodyParsed = new Promise((resolve) => (bodyRead = resolve));
    const app = express();
    app.use(express.json());
    // Corps lu : le client ferme alors brutalement la connexion, avant le traitement.
    app.use((req, res, next) => (bodyRead(), setTimeout(next, 100)));
    app.post("/login", createExpressAuth(counted).login());
    const server = await startServer(app);
    try {
      const { port } = new URL(server.baseUrl);
      const body = JSON.stringify({ identifier: "alice@example.test", password: "wrong" });
      await new Promise((resolve) => {
        const socket = connect(Number(port), "127.0.0.1", () => {
          socket.write(`POST /login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          bodyParsed.then(() => {
            socket.resetAndDestroy();
            resolve();
          });
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(logins, 0);
    } finally {
      await server.close();
    }
  });

  it("reports the client address of rejected access tokens", async () => {
    const events = [];
    const { auth } = await setup({ audit: (e) => events.push(e) });
    const app = express();
    app.get("/me", createExpressAuth(auth).authenticate(), (req, res) => res.end());
    const server = await startServer(app);
    try {
      assert.equal((await server.request("/me", { headers: { authorization: "Bearer not.a.jwt" } })).status, 401);
    } finally {
      await server.close();
    }
    assert.equal(events.find((e) => e.type === "token.rejected")?.client, "127.0.0.1");
  });
});

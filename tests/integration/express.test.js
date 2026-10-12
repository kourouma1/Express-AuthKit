import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import express from "express";
import { SignJWT } from "jose";

import { createExpressAuth } from "../../src/adapters/express/index.js";
import {
  ConfigurationError,
  ContractViolationError,
  createAuthKit,
  createInMemoryRefreshTokenStore
} from "../../src/index.js";
import {
  FAST_ARGON2,
  TEST_AUDIENCE,
  TEST_ISSUER,
  TEST_PASSWORD,
  TEST_SECRET,
  createInMemoryUserRepository,
  createTestAuthKit,
  jwtOptions
} from "../helpers/fixtures.js";
import { startServer } from "../helpers/http.js";

/**
 * Application Express réelle, configurée comme dans la documentation.
 */
async function createApp() {
  const { auth, repository } = await createTestAuthKit();
  const expressAuth = createExpressAuth(auth);
  const app = express();
  app.use(express.json());

  app.post("/auth/login", async (req, res, next) => {
    try {
      const result = await auth.login({ identifier: req.body?.identifier, password: req.body?.password });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/profile", expressAuth.authenticate(), (req, res) => {
    res.json({ userId: req.auth.userId, principal: req.auth });
  });

  app.get("/boom", () => {
    throw new Error("unrelated failure");
  });

  app.use(expressAuth.errorHandler());
  // Solution de secours de l’application : erreur 500 générique, sans détail interne.
  app.use((error, req, res, _next) => {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
  });

  return { app, repository };
}

describe("Express adapter", () => {
  let server;
  let repository;

  before(async () => {
    const created = await createApp();
    repository = created.repository;
    server = await startServer(created.app);
  });

  after(() => server.close());

  async function login(identifier = "alice@example.test", password = TEST_PASSWORD) {
    return server.request("/auth/login", { method: "POST", body: { identifier, password } });
  }

  it("logs in and reaches a protected route", async () => {
    const loginResponse = await login();
    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.body.tokenType, "Bearer");
    assert.equal(JSON.stringify(loginResponse.body).includes("argon2"), false);

    const profile = await server.request("/profile", {
      headers: { authorization: `Bearer ${loginResponse.body.accessToken}` }
    });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.userId, "user-1");
    assert.deepEqual(Object.keys(profile.body.principal).sort(), ["expiresAt", "issuedAt", "permissions", "roles", "tokenId", "userId"]);
  });

  it("answers 401 with a generic body for every login failure", async () => {
    const responses = await Promise.all([
      login("nobody@example.test"),
      login("alice@example.test", "wrong password"),
      login("bob@example.test")
    ]);
    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { error: { code: "INVALID_CREDENTIALS", message: "Identifiants invalides." } });
      assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="api"');
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("answers 400 for malformed login payloads", async () => {
    const response = await server.request("/auth/login", { method: "POST", body: { identifier: ["x"], password: 1 } });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_INPUT");
  });

  it("requires a token on protected routes", async () => {
    for (const headers of [{}, { authorization: "Basic dXNlcjpwYXNz" }]) {
      const response = await server.request("/profile", { headers });
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, "TOKEN_MISSING");
      assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="api"');
    }
  });

  it("rejects malformed and forged tokens", async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject("user-1")
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setJti("forged")
      .sign(new TextEncoder().encode(`${TEST_SECRET}-attacker`));

    for (const authorization of ["Bearer not-a-jwt", "Bearer a b", `Bearer ${forged}`]) {
      const response = await server.request("/profile", { headers: { authorization } });
      assert.equal(response.status, 401, authorization);
      assert.deepEqual(response.body, { error: { code: "TOKEN_INVALID", message: "Jeton d’accès invalide." } });
      assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="api", error="invalid_token"');
    }
  });

  it("rejects expired tokens with TOKEN_EXPIRED", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject("user-1")
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt(now - 1000)
      .setExpirationTime(now - 100)
      .setJti("expired")
      .sign(new TextEncoder().encode(TEST_SECRET));

    const response = await server.request("/profile", { headers: { authorization: `Bearer ${expired}` } });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "TOKEN_EXPIRED");
  });

  it("rejects the token of a user disabled after login", async () => {
    const { body } = await login();
    repository.users.get("user-1").isActive = false;
    try {
      const response = await server.request("/profile", { headers: { authorization: `Bearer ${body.accessToken}` } });
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, "TOKEN_INVALID");
    } finally {
      repository.users.get("user-1").isActive = true;
    }
  });

  it("forwards repository failures to the application error handler without leaking details", async () => {
    const { body } = await login();
    const original = repository.findById;
    repository.findById = async () => {
      throw new Error("ECONNREFUSED db.internal:5432");
    };
    try {
      const response = await server.request("/profile", { headers: { authorization: `Bearer ${body.accessToken}` } });
      assert.equal(response.status, 500);
      assert.equal(JSON.stringify(response.body).includes("db.internal"), false);
    } finally {
      repository.findById = original;
    }
  });

  it("lets non-authentication errors through errorHandler()", async () => {
    const response = await server.request("/boom");
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "INTERNAL_ERROR");
  });
});

describe("createExpressAuth validation", () => {
  it("requires an engine created by createAuthKit()", () => {
    assert.throws(() => createExpressAuth({}), ContractViolationError);
    assert.throws(() => createExpressAuth(undefined), ContractViolationError);
  });

  it("validates the realm to prevent header injection", async () => {
    const { auth } = await createTestAuthKit();
    assert.throws(() => createExpressAuth(auth, { realm: 'api", evil="1' }), ConfigurationError);
    assert.throws(() => createExpressAuth(auth, { realm: "api\r\nSet-Cookie: x=1" }), ConfigurationError);
    assert.throws(() => createExpressAuth(auth, { unknown: true }), ConfigurationError);
    assert.doesNotThrow(() => createExpressAuth(auth, { realm: "my-api" }));
  });

  it("uses the custom realm in challenges", async () => {
    const { auth } = await createTestAuthKit();
    const app = express();
    app.get("/private", createExpressAuth(auth, { realm: "my-api" }).authenticate(), (req, res) => res.end());
    const server = await startServer(app);
    try {
      const response = await server.request("/private");
      assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="my-api"');
    } finally {
      await server.close();
    }
  });
});

describe("expressAuth.login()", () => {
  let server;

  before(async () => {
    const { auth } = await createTestAuthKit();
    const expressAuth = createExpressAuth(auth);
    const app = express();
    app.post("/login", express.json(), expressAuth.login());
    app.post("/login-email", express.json(), expressAuth.login({ identifierField: "email" }));
    app.post("/login-no-parser", expressAuth.login());
    app.get("/profile", expressAuth.authenticate(), (req, res) => res.json({ userId: req.auth.userId }));
    server = await startServer(app);
  });

  after(() => server.close());

  it("logs in with a single line of setup and the token works", async () => {
    const response = await server.request("/login", {
      method: "POST",
      body: { identifier: "alice@example.test", password: TEST_PASSWORD }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body).sort(), ["accessToken", "expiresIn", "tokenType"]);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const profile = await server.request("/profile", {
      headers: { authorization: `Bearer ${response.body.accessToken}` }
    });
    assert.deepEqual(profile.body, { userId: "user-1" });
  });

  it("supports a custom identifier field", async () => {
    const response = await server.request("/login-email", {
      method: "POST",
      body: { email: "alice@example.test", password: TEST_PASSWORD }
    });
    assert.equal(response.status, 200);
  });

  it("answers 401 INVALID_CREDENTIALS without needing errorHandler()", async () => {
    const response = await server.request("/login", {
      method: "POST",
      body: { identifier: "alice@example.test", password: "wrong password" }
    });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: { code: "INVALID_CREDENTIALS", message: "Identifiants invalides." } });
  });

  it("explains a missing JSON body", async () => {
    const response = await server.request("/login-no-parser", {
      method: "POST",
      body: { identifier: "alice@example.test", password: TEST_PASSWORD }
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_INPUT");
    assert.match(response.body.error.message, /Content-Type: application\/json/);
  });

  it("ignores inherited properties of the body", async () => {
    const response = await server.request("/login", {
      method: "POST",
      body: JSON.parse('{"__proto__": {"identifier": "alice@example.test", "password": "x"}}')
    });
    assert.equal(response.status, 400);
  });

  it("validates its options", async () => {
    const { auth } = await createTestAuthKit();
    const expressAuth = createExpressAuth(auth);
    for (const identifierField of ["", "a.b", "__proto__ ", 42]) {
      assert.throws(() => expressAuth.login({ identifierField }), ConfigurationError);
    }
    assert.throws(() => expressAuth.login({ field: "email" }), ConfigurationError);
  });
});

describe("Express error handling", () => {
  let server;

  before(async () => {
    const { auth } = await createTestAuthKit();
    const expressAuth = createExpressAuth(auth);
    const app = express();
    app.post("/login", express.json({ limit: "1kb" }), expressAuth.login({ identifierField: "email" }));
    // Erreur volontaire : parenthèses oubliées.
    app.get("/forgot-parentheses", expressAuth.authenticate, (req, res) => res.end());
    app.use(expressAuth.errorHandler());
    app.use((error, req, res, _next) => {
      res.status(500).json({ error: { code: error.code ?? "INTERNAL_ERROR", message: error.message } });
    });
    server = await startServer(app);
  });

  after(() => server.close());

  async function postRaw(path, body) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    return { status: response.status, type: response.headers.get("content-type"), body: await response.json() };
  }

  it("answers malformed JSON with a clean French JSON error", async () => {
    const response = await postRaw("/login", "{not json");
    assert.equal(response.status, 400);
    assert.match(response.type, /application\/json/);
    assert.deepEqual(response.body, {
      error: { code: "INVALID_INPUT", message: "Le corps de la requête n’est pas un JSON valide." }
    });
  });

  it("answers oversized bodies with 413", async () => {
    const response = await postRaw("/login", JSON.stringify({ email: "a".repeat(2000), password: "x" }));
    assert.equal(response.status, 413);
    assert.equal(response.body.error.message, "Le corps de la requête est trop volumineux.");
  });

  it("names the configured identifier field in validation messages", async () => {
    const response = await postRaw("/login", JSON.stringify({ identifier: "alice@example.test", password: "x" }));
    assert.equal(response.status, 400);
    assert.equal(response.body.error.message, "Le champ « email » est obligatoire et doit être un texte non vide.");
  });

  it("fails fast instead of hanging when parentheses are forgotten", async () => {
    const response = await fetch(`${server.baseUrl}/forgot-parentheses`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, "INVALID_CONFIGURATION");
    assert.match(body.error.message, /écrivez expressAuth\.authenticate\(\)/);
  });

  it("rejects factory misuse for every helper", async () => {
    const { auth } = await createTestAuthKit();
    const expressAuth = createExpressAuth(auth);
    const fakeReq = {};
    const fakeRes = {};
    const next = () => {};
    assert.throws(() => expressAuth.authenticate(fakeReq, fakeRes, next), ConfigurationError);
    assert.throws(() => expressAuth.login(fakeReq, fakeRes, next), ConfigurationError);
    assert.throws(() => expressAuth.errorHandler(new Error("x"), fakeReq, fakeRes, next), ConfigurationError);
    assert.throws(() => expressAuth.refresh(fakeReq, fakeRes, next), ConfigurationError);
    assert.throws(() => expressAuth.logout(fakeReq, fakeRes, next), ConfigurationError);
  });
});

describe("expressAuth.refresh() and expressAuth.logout()", () => {
  let server;

  before(async () => {
    const users = createInMemoryUserRepository();
    const auth = createAuthKit({
      users,
      jwt: jwtOptions(),
      password: FAST_ARGON2,
      refreshTokens: { store: createInMemoryRefreshTokenStore() }
    });
    users.users.set("user-1", {
      id: "user-1",
      email: "alice@example.test",
      passwordHash: await auth.password.hash(TEST_PASSWORD),
      isActive: true
    });
    const expressAuth = createExpressAuth(auth);
    const app = express();
    app.use(express.json());
    app.post("/login", expressAuth.login({ identifierField: "email" }));
    app.post("/refresh", expressAuth.refresh());
    app.post("/logout", expressAuth.logout());
    app.get("/profile", expressAuth.authenticate(), (req, res) => res.json({ userId: req.auth.userId }));
    server = await startServer(app);
  });

  after(() => server.close());

  const post = (path, body) => server.request(path, { method: "POST", body });

  it("runs the full session cycle: login → refresh → logout", async () => {
    const login = await post("/login", { email: "alice@example.test", password: TEST_PASSWORD });
    assert.equal(login.status, 200);
    assert.deepEqual(Object.keys(login.body).sort(), [
      "accessToken",
      "expiresIn",
      "refreshExpiresIn",
      "refreshToken",
      "tokenType"
    ]);

    const refreshed = await post("/refresh", { refreshToken: login.body.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.headers.get("cache-control"), "no-store");
    assert.notEqual(refreshed.body.refreshToken, login.body.refreshToken);
    const profile = await server.request("/profile", {
      headers: { authorization: `Bearer ${refreshed.body.accessToken}` }
    });
    assert.deepEqual(profile.body, { userId: "user-1" });

    const logout = await post("/logout", { refreshToken: refreshed.body.refreshToken });
    assert.equal(logout.status, 204);
    const afterLogout = await post("/refresh", { refreshToken: refreshed.body.refreshToken });
    assert.equal(afterLogout.status, 401);
  });

  it("answers 401 REFRESH_TOKEN_INVALID without revealing the reason", async () => {
    const login = await post("/login", { email: "alice@example.test", password: TEST_PASSWORD });
    await post("/refresh", { refreshToken: login.body.refreshToken });
    const replay = await post("/refresh", { refreshToken: login.body.refreshToken });
    assert.equal(replay.status, 401);
    assert.deepEqual(replay.body, {
      error: { code: "REFRESH_TOKEN_INVALID", message: "Jeton de rafraîchissement invalide ou expiré. Reconnectez-vous." }
    });
  });

  it("answers 400 when refreshToken is missing", async () => {
    for (const path of ["/refresh", "/logout"]) {
      const response = await post(path, {});
      assert.equal(response.status, 400, path);
      assert.equal(response.body.error.code, "INVALID_INPUT");
    }
  });

  it("logout twice still answers 204", async () => {
    const login = await post("/login", { email: "alice@example.test", password: TEST_PASSWORD });
    assert.equal((await post("/logout", { refreshToken: login.body.refreshToken })).status, 204);
    assert.equal((await post("/logout", { refreshToken: login.body.refreshToken })).status, 204);
  });
});

describe("Express: login attempt limiting and audit", () => {
  let server;
  const events = [];

  before(async () => {
    const users = createInMemoryUserRepository();
    const auth = createAuthKit({
      users,
      jwt: jwtOptions(),
      password: FAST_ARGON2,
      loginAttempts: { maxFailuresPerIdentifier: 2, maxAttemptsPerClient: 50 },
      audit: (event) => events.push(event)
    });
    const passwordHash = await auth.password.hash(TEST_PASSWORD);
    users.users.set("u1", { id: "u1", email: "alice@example.test", passwordHash, isActive: true });
    const expressAuth = createExpressAuth(auth);
    const app = express();
    app.use(express.json());
    app.post("/login", expressAuth.login({ identifierField: "email" }));
    app.get("/admin", expressAuth.authorize("admin"), (req, res) => res.end());
    server = await startServer(app);
  });

  after(() => server.close());

  const login = (email, password) => server.request("/login", { method: "POST", body: { email, password } });

  it("answers 429 with Retry-After once the account is locked", async () => {
    assert.equal((await login("alice@example.test", "wrong")).status, 401);
    assert.equal((await login("alice@example.test", "wrong")).status, 401);
    const blocked = await login("alice@example.test", TEST_PASSWORD);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "TOO_MANY_ATTEMPTS");
    assert.match(blocked.body.error.message, /Réessayez dans 15 minutes/);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    assert.ok(retryAfter > 800 && retryAfter <= 900, String(retryAfter));
    assert.equal(blocked.headers.get("cache-control"), "no-store");
  });

  it("passes the client IP to the limiter and the audit", () => {
    const failed = events.find((e) => e.type === "login.failed");
    assert.equal(failed.client, "127.0.0.1");
    assert.ok(events.some((e) => e.type === "account.locked"));
  });

  it("audits access denied by authorize()", async () => {
    const other = createInMemoryUserRepository();
    const auditEvents = [];
    const auth = createAuthKit({ users: other, jwt: jwtOptions(), password: FAST_ARGON2, audit: (e) => auditEvents.push(e) });
    other.users.set("u9", { id: "u9", email: "eve@example.test", passwordHash: await auth.password.hash(TEST_PASSWORD), isActive: true });
    const app = express();
    app.get("/admin", createExpressAuth(auth).authorize("admin"), (req, res) => res.end());
    const local = await startServer(app);
    try {
      const { accessToken } = await auth.login({ identifier: "eve@example.test", password: TEST_PASSWORD });
      const response = await local.request("/admin?debug=1", { headers: { authorization: `Bearer ${accessToken}` } });
      assert.equal(response.status, 403);
      const denied = auditEvents.find((e) => e.type === "access.denied");
      assert.deepEqual({ userId: denied.userId, method: denied.method, path: denied.path }, { userId: "u9", method: "GET", path: "/admin" });
    } finally {
      await local.close();
    }
  });
});

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import express from "express";
import { SignJWT } from "jose";

import { createExpressAuth } from "../../src/adapters/express/index.js";
import { ConfigurationError, ContractViolationError } from "../../src/index.js";
import { TEST_AUDIENCE, TEST_ISSUER, TEST_PASSWORD, TEST_SECRET, createTestAuthKit } from "../helpers/fixtures.js";
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
    assert.deepEqual(Object.keys(profile.body.principal).sort(), ["expiresAt", "issuedAt", "tokenId", "userId"]);
  });

  it("answers 401 with a generic body for every login failure", async () => {
    const responses = await Promise.all([
      login("nobody@example.test"),
      login("alice@example.test", "wrong password"),
      login("bob@example.test")
    ]);
    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } });
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
      assert.deepEqual(response.body, { error: { code: "TOKEN_INVALID", message: "Invalid access token." } });
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
    assert.deepEqual(response.body, { error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } });
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

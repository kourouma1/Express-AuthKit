import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import express from "express";
import { decodeJwt } from "jose";

import { createExpressAuth } from "../../src/adapters/express/index.js";
import { ConfigurationError, createAuthKit } from "../../src/index.js";
import { FAST_ARGON2, TEST_PASSWORD, createInMemoryUserRepository, jwtOptions } from "../helpers/fixtures.js";
import { startServer } from "../helpers/http.js";

/**
 * Application Express réelle avec trois utilisateurs : un admin, un éditeur
 * (avec permissions) et un utilisateur sans rôle.
 */
async function createApp() {
  const users = createInMemoryUserRepository();
  // Le repository de test ne renvoie que id/passwordHash/isActive : on l'étend
  // pour renvoyer aussi les rôles et permissions.
  const withAuthorities = async (lookup, value) => {
    const record = await lookup(value);
    if (record === null) return null;
    const user = users.users.get(record.id);
    return { ...record, roles: user.roles, permissions: user.permissions };
  };
  const repository = {
    findByIdentifier: (identifier) => withAuthorities(users.findByIdentifier, identifier),
    findById: (id) => withAuthorities(users.findById, id)
  };
  const auth = createAuthKit({ users: repository, jwt: jwtOptions(), password: FAST_ARGON2 });
  const passwordHash = await auth.password.hash(TEST_PASSWORD);
  const add = (id, roles, permissions = []) =>
    users.users.set(id, { id, email: `${id}@example.test`, passwordHash, isActive: true, roles, permissions });
  add("admin", ["admin"]);
  add("editor", ["editor"], ["articles:write"]);
  add("nobody", []);

  const expressAuth = createExpressAuth(auth);
  const app = express();
  app.use(express.json());
  app.post("/login", expressAuth.login());

  app.get("/admin", expressAuth.authorize("admin"), (req, res) => res.json({ ok: true, roles: req.auth.roles }));
  app.get("/staff", expressAuth.authorize({ anyRole: ["admin", "editor"] }), (req, res) => res.json({ ok: true }));
  app.post("/articles", expressAuth.authorize({ allPermissions: ["articles:write"] }), (req, res) => res.json({ ok: true }));
  app.get(
    "/users/:id",
    expressAuth.authorize({ check: (user, req) => user.userId === req.params.id || user.roles.includes("admin") }),
    (req, res) => res.json({ ok: true })
  );
  app.get("/broken-check", expressAuth.authorize({ check: () => "yes" }), (req, res) => res.json({ ok: true }));
  app.get(
    "/throwing-check",
    expressAuth.authorize({
      check: () => {
        throw new Error("bug in application rule");
      }
    }),
    (req, res) => res.json({ ok: true })
  );

  // authenticate() puis authorize() : l'utilisateur n'est vérifié qu'une fois.
  const router = express.Router();
  router.use(expressAuth.authenticate());
  router.get("/report", expressAuth.authorize("admin"), (req, res) => res.json({ ok: true }));
  app.use("/internal", router);

  // Un middleware malveillant ou buggé qui pose req.auth lui-même.
  app.get(
    "/spoofed",
    (req, res, next) => {
      req.auth = { userId: "admin", roles: ["admin"], permissions: [] };
      next();
    },
    expressAuth.authorize("admin"),
    (req, res) => res.json({ ok: true })
  );

  app.use((error, req, res, _next) => res.status(500).json({ error: { code: error.code ?? "INTERNAL_ERROR" } }));
  return { app, users, repository };
}

describe("expressAuth.authorize()", () => {
  let server;
  let users;
  const tokens = {};

  before(async () => {
    const created = await createApp();
    users = created.users;
    server = await startServer(created.app);
    for (const id of ["admin", "editor", "nobody"]) {
      const response = await server.request("/login", {
        method: "POST",
        body: { identifier: `${id}@example.test`, password: TEST_PASSWORD }
      });
      tokens[id] = response.body.accessToken;
    }
  });

  after(() => server.close());

  const get = (path, who, method = "GET") =>
    server.request(path, { method, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });

  it("answers 401 without a token and 403 without the role", async () => {
    assert.equal((await get("/admin")).status, 401);

    const forbidden = await get("/admin", "editor");
    assert.equal(forbidden.status, 403);
    assert.deepEqual(forbidden.body, {
      error: { code: "ACCESS_DENIED", message: "Accès refusé : vous n’avez pas les droits nécessaires." }
    });
    assert.equal(forbidden.headers.get("www-authenticate"), 'Bearer realm="api", error="insufficient_scope"');

    const allowed = await get("/admin", "admin");
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body.roles, ["admin"]);
  });

  it("supports anyRole, allPermissions and custom checks", async () => {
    assert.equal((await get("/staff", "editor")).status, 200);
    assert.equal((await get("/staff", "nobody")).status, 403);
    assert.equal((await get("/articles", "editor", "POST")).status, 200);
    assert.equal((await get("/articles", "admin", "POST")).status, 403);
    assert.equal((await get("/users/nobody", "nobody")).status, 200);
    assert.equal((await get("/users/editor", "nobody")).status, 403);
    assert.equal((await get("/users/editor", "admin")).status, 200);
  });

  it("applies role changes immediately, without a new login", async () => {
    users.users.get("nobody").roles = ["admin"];
    try {
      assert.equal((await get("/admin", "nobody")).status, 200);
    } finally {
      users.users.get("nobody").roles = [];
    }
    assert.equal((await get("/admin", "nobody")).status, 403);
  });

  it("never writes roles or permissions into the JWT", () => {
    const payload = decodeJwt(tokens.editor);
    assert.equal("roles" in payload, false);
    assert.equal("permissions" in payload, false);
  });

  it("reuses the principal set by authenticate()", async () => {
    assert.equal((await get("/internal/report", "admin")).status, 200);
    assert.equal((await get("/internal/report", "editor")).status, 403);
  });

  it("ignores a req.auth value that was not set by authenticate()", async () => {
    assert.equal((await get("/spoofed")).status, 401);
    assert.equal((await get("/spoofed", "editor")).status, 403);
  });

  it("forwards broken or failing custom checks to the error handler (fail closed)", async () => {
    const broken = await get("/broken-check", "admin");
    assert.equal(broken.status, 500);
    assert.equal(broken.body.error.code, "CONTRACT_VIOLATION");
    assert.equal((await get("/throwing-check", "admin")).status, 500);
  });
});

describe("expressAuth.authorize() validation", () => {
  it("rejects invalid rules and forgotten parentheses at startup", async () => {
    const { repository } = await createApp();
    const expressAuth = createExpressAuth(createAuthKit({ users: repository, jwt: jwtOptions(), password: FAST_ARGON2 }));
    assert.throws(() => expressAuth.authorize(), ConfigurationError);
    assert.throws(() => expressAuth.authorize({ role: "admin" }), ConfigurationError);
    assert.throws(() => expressAuth.authorize({ anyRole: [] }), ConfigurationError);
    assert.throws(() => expressAuth.authorize({}, {}, () => {}), ConfigurationError);
  });
});

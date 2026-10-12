import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { createAuthKit } from "express-authkit";

import { createApp } from "../src/app.js";
import { InMemoryUserRepository } from "../src/in-memory-user-repository.js";
import { createLoginRateLimiters } from "../src/rate-limit.js";

const PASSWORD = "a long and unique passphrase";

describe("example application", () => {
  let baseUrl;
  let server;
  let users;
  let demoUser;

  before(async () => {
    users = new InMemoryUserRepository();
    const auth = createAuthKit({
      users,
      jwt: { secret: randomBytes(48).toString("base64url"), issuer: "example", audience: "example-client" },
      password: { memoryCost: 19_456, timeCost: 2, parallelism: 1 }
    });
    demoUser = users.create({ email: "Alice@Example.test", name: "Alice", passwordHash: await auth.password.hash(PASSWORD) });

    const app = createApp({ auth, users, loginRateLimiters: createLoginRateLimiters({ perIdentifierLimit: 3 }) });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const login = (identifier, password) =>
    fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, password })
    });

  it("logs in and returns the public profile without the password hash", async () => {
    const loginResponse = await login("alice@example.test", PASSWORD);
    assert.equal(loginResponse.status, 200);
    const { accessToken, tokenType, expiresIn } = await loginResponse.json();
    assert.equal(tokenType, "Bearer");
    assert.equal(expiresIn, 900);

    const me = await fetch(`${baseUrl}/me`, { headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.deepEqual(body, { userId: demoUser.id, profile: demoUser });
    assert.equal(JSON.stringify(body).includes("argon2"), false);
  });

  it("protects /me", async () => {
    assert.equal((await fetch(`${baseUrl}/me`)).status, 401);
    const forged = await fetch(`${baseUrl}/me`, { headers: { authorization: "Bearer eyJhbGciOiJub25lIn0.e30." } });
    assert.equal(forged.status, 401);
  });

  it("rejects a disabled user's existing token", async () => {
    const { accessToken } = await (await login("alice@example.test", PASSWORD)).json();
    users.setActive(demoUser.id, false);
    try {
      const me = await fetch(`${baseUrl}/me`, { headers: { authorization: `Bearer ${accessToken}` } });
      assert.equal(me.status, 401);
    } finally {
      users.setActive(demoUser.id, true);
    }
  });

  it("rejects invalid JSON bodies without leaking details", async () => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json"
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: "INVALID_REQUEST", message: "Invalid request body." } });
  });

  it("rate-limits repeated failures on the same identifier", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await login("target@example.test", "wrong password")).status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 429]);
  });
});

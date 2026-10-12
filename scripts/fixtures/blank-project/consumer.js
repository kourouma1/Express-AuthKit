// Scénario du README exécuté dans un projet vierge, contre le tarball publié.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import express from "express";
import { createAuthKit, isAuthKitError } from "express-authkit";
import { createExpressAuth } from "express-authkit/express";

const users = new Map();
const userRepository = {
  async findByIdentifier(identifier) {
    return [...users.values()].find((user) => user.email === identifier) ?? null;
  },
  async findById(id) {
    return users.get(id) ?? null;
  }
};

const auth = createAuthKit({
  users: userRepository,
  jwt: {
    secret: randomBytes(48).toString("base64url"),
    issuer: "my-api",
    audience: "my-client",
    expiresInSeconds: 900
  }
});
const expressAuth = createExpressAuth(auth);

const hash = await auth.password.hash("example-password");
users.set("42", { id: "42", email: "alice@example.test", passwordHash: hash, isActive: true });

const app = express();
app.get("/profile", expressAuth.authenticate(), (req, res) => {
  res.json({ userId: req.auth.userId });
});

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const { accessToken } = await auth.login({ identifier: "alice@example.test", password: "example-password" });
  const ok = await fetch(`${baseUrl}/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  assert.deepEqual(await ok.json(), { userId: "42" });

  const denied = await fetch(`${baseUrl}/profile`, { headers: { authorization: "Bearer invalid.token.value" } });
  assert.equal(denied.status, 401);

  await assert.rejects(auth.login({ identifier: "alice@example.test", password: "wrong" }), (error) => isAuthKitError(error));
  console.log("consumer scenario OK");
} finally {
  server.close();
}

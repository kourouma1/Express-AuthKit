import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTH_FAILURE_REASONS,
  InvalidCredentialsError,
  InvalidPasswordHashError,
  InvalidTokenError,
  createAuthKit
} from "../../src/index.js";
import {
  FAST_ARGON2,
  TEST_PASSWORD,
  createInMemoryUserRepository,
  createTestAuthKit,
  jwtOptions
} from "../helpers/fixtures.js";

/**
 * Tests de bout en bout du moteur avec les vrais fournisseurs Argon2id et JWT.
 */
describe("login security", () => {
  it("logs in an active user and accepts the issued token", async () => {
    const { auth } = await createTestAuthKit();
    const result = await auth.login({ identifier: "Alice@Example.test ", password: TEST_PASSWORD });
    assert.equal(result.tokenType, "Bearer");
    assert.equal(result.expiresIn, 900);
    assert.equal(result.principal.userId, "user-1");

    const principal = await auth.verifyAccessToken(result.accessToken);
    assert.equal(principal.userId, "user-1");
    assert.equal(principal.tokenId, result.principal.tokenId);
  });

  it("returns the same public error for unknown user, wrong password and disabled account", async () => {
    const { auth } = await createTestAuthKit();
    const attempts = [
      { identifier: "nobody@example.test", password: TEST_PASSWORD, reason: AUTH_FAILURE_REASONS.USER_NOT_FOUND },
      { identifier: "alice@example.test", password: "wrong password", reason: AUTH_FAILURE_REASONS.INVALID_PASSWORD },
      { identifier: "bob@example.test", password: TEST_PASSWORD, reason: AUTH_FAILURE_REASONS.ACCOUNT_DISABLED }
    ];

    const publicShapes = [];
    for (const { identifier, password, reason } of attempts) {
      await assert.rejects(auth.login({ identifier, password }), (error) => {
        assert.ok(error instanceof InvalidCredentialsError);
        assert.equal(error.reason, reason);
        publicShapes.push(JSON.stringify({ code: error.code, message: error.message, name: error.name }));
        return true;
      });
    }
    assert.equal(new Set(publicShapes).size, 1);
  });

  it("performs a real Argon2id verification for unknown users", async () => {
    const repository = createInMemoryUserRepository();
    const verifiedHashes = [];
    const auth = createAuthKit({ users: repository, jwt: jwtOptions(), password: FAST_ARGON2 });
    const realVerify = auth.password.verify;
    const spyingAuth = createAuthKit({
      users: repository,
      jwt: jwtOptions(),
      providers: {
        password: {
          hash: auth.password.hash,
          async verify(password, hash) {
            verifiedHashes.push(hash);
            return realVerify(password, hash);
          }
        }
      }
    });

    await assert.rejects(spyingAuth.login({ identifier: "ghost@example.test", password: "x" }), InvalidCredentialsError);
    assert.equal(verifiedHashes.length, 1);
    assert.match(verifiedHashes[0], /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
  });

  it("rejects tokens once the account is disabled or deleted", async () => {
    const { auth, repository } = await createTestAuthKit();
    const { accessToken } = await auth.login({ identifier: "alice@example.test", password: TEST_PASSWORD });

    repository.users.get("user-1").isActive = false;
    await assert.rejects(auth.verifyAccessToken(accessToken), InvalidTokenError);

    repository.users.delete("user-1");
    await assert.rejects(auth.verifyAccessToken(accessToken), InvalidTokenError);
  });

  it("does not accept a token issued for another audience", async () => {
    const { auth } = await createTestAuthKit();
    const { auth: otherService } = await createTestAuthKit({ jwt: { audience: "another-client" } });
    const { accessToken } = await otherService.login({ identifier: "alice@example.test", password: TEST_PASSWORD });
    await assert.rejects(auth.verifyAccessToken(accessToken), InvalidTokenError);
  });

  it("works end to end with numeric identifiers (SQL auto-increment)", async () => {
    const auth0 = createAuthKit({ users: createInMemoryUserRepository(), jwt: jwtOptions(), password: FAST_ARGON2 });
    const passwordHash = await auth0.password.hash(TEST_PASSWORD);
    const rows = new Map([[42, { id: 42, passwordHash, isActive: true }]]);
    const auth = createAuthKit({
      users: {
        findByIdentifier: async (identifier) => (identifier === "carol" ? rows.get(42) : null),
        findById: async (id) => rows.get(Number(id)) ?? null
      },
      jwt: jwtOptions(),
      password: FAST_ARGON2
    });
    const { accessToken, principal } = await auth.login({ identifier: "carol", password: TEST_PASSWORD });
    assert.equal(principal.userId, "42");
    assert.equal((await auth.verifyAccessToken(accessToken)).userId, "42");
  });

  it("surfaces unreadable stored hashes as server errors, not as wrong passwords", async () => {
    const repository = createInMemoryUserRepository([
      { id: "legacy", email: "legacy@example.test", passwordHash: "$2b$10$legacybcrypthash", isActive: true }
    ]);
    const auth = createAuthKit({ users: repository, jwt: jwtOptions(), password: FAST_ARGON2 });
    await assert.rejects(auth.login({ identifier: "legacy@example.test", password: "x" }), InvalidPasswordHashError);
  });
});

import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { createAuthenticationService } from "../../src/core/authentication-service.js";
import {
  AUTH_FAILURE_REASONS,
  ContractViolationError,
  DependencyFailureError,
  InvalidCredentialsError,
  InvalidInputError,
  InvalidTokenError,
  TokenExpiredError,
  TokenMissingError
} from "../../src/index.js";

/**
 * Tests unitaires purs : toutes les dépendances sont simulées, sans cryptographie.
 */
function createMocks() {
  const users = {
    findByIdentifier: mock.fn(async (identifier) =>
      identifier === "alice" ? { id: "u1", passwordHash: "hash-alice", isActive: true } : null
    ),
    findById: mock.fn(async (id) => (id === "u1" ? { id: "u1", passwordHash: "hash-alice", isActive: true } : null))
  };
  const passwordProvider = {
    hash: mock.fn(async () => "dummy-hash"),
    verify: mock.fn(async (password, hash) => password === "good-password" && hash === "hash-alice")
  };
  const tokenProvider = {
    issue: mock.fn(async ({ subject }) => ({ token: `token-for-${subject}`, tokenId: "jti-1", issuedAt: 1000, expiresAt: 1900 })),
    verify: mock.fn(async (token) => {
      if (token === "expired") throw new TokenExpiredError();
      if (token !== "valid-token") throw new InvalidTokenError();
      return { subject: "u1", tokenId: "jti-1", issuedAt: 1000, expiresAt: 1900 };
    })
  };
  return { users, passwordProvider, tokenProvider };
}

describe("AuthenticationService.login", () => {
  let deps;
  let service;
  beforeEach(() => {
    deps = createMocks();
    service = createAuthenticationService(deps);
  });

  it("returns a bearer token and a frozen principal for valid credentials", async () => {
    const result = await service.login({ identifier: "alice", password: "good-password" });
    assert.deepEqual(result, {
      accessToken: "token-for-u1",
      tokenType: "Bearer",
      expiresIn: 900,
      principal: { userId: "u1", tokenId: "jti-1", issuedAt: 1000, expiresAt: 1900 }
    });
    assert.ok(Object.isFrozen(result.principal));
    assert.deepEqual(deps.tokenProvider.issue.mock.calls[0].arguments, [{ subject: "u1" }]);
  });

  it("never returns the password hash", async () => {
    const result = await service.login({ identifier: "alice", password: "good-password" });
    assert.equal(JSON.stringify(result).includes("hash-alice"), false);
  });

  it("rejects a wrong password", async () => {
    await assert.rejects(service.login({ identifier: "alice", password: "bad" }), (error) => {
      assert.ok(error instanceof InvalidCredentialsError);
      assert.equal(error.reason, AUTH_FAILURE_REASONS.INVALID_PASSWORD);
      return true;
    });
    assert.equal(deps.tokenProvider.issue.mock.callCount(), 0);
  });

  it("only accepts a strict `true` from the password provider", async () => {
    deps.passwordProvider.verify.mock.mockImplementation(async () => "yes");
    await assert.rejects(service.login({ identifier: "alice", password: "good-password" }), InvalidCredentialsError);
  });

  it("runs a dummy verification for unknown users (timing mitigation)", async () => {
    await assert.rejects(service.login({ identifier: "mallory", password: "whatever" }), (error) => {
      assert.ok(error instanceof InvalidCredentialsError);
      assert.equal(error.reason, AUTH_FAILURE_REASONS.USER_NOT_FOUND);
      return true;
    });
    assert.equal(deps.passwordProvider.verify.mock.callCount(), 1);
    assert.deepEqual(deps.passwordProvider.verify.mock.calls[0].arguments, ["whatever", "dummy-hash"]);
  });

  it("computes the dummy hash once and reuses it", async () => {
    await assert.rejects(service.login({ identifier: "x", password: "p" }));
    await assert.rejects(service.login({ identifier: "y", password: "p" }));
    assert.equal(deps.passwordProvider.hash.mock.callCount(), 1);
  });

  it("retries the dummy hash after a failure instead of caching the error", async () => {
    deps.passwordProvider.hash.mock.mockImplementationOnce(async () => {
      throw new Error("transient");
    });
    await assert.rejects(service.login({ identifier: "x", password: "p" }), (error) => {
      assert.ok(error instanceof DependencyFailureError);
      assert.equal(error.cause.message, "transient");
      return true;
    });
    await assert.rejects(service.login({ identifier: "x", password: "p" }), InvalidCredentialsError);
  });

  it("rejects disabled accounts after verifying the password", async () => {
    deps.users.findByIdentifier.mock.mockImplementation(async () => ({ id: "u1", passwordHash: "hash-alice", isActive: false }));
    await assert.rejects(service.login({ identifier: "alice", password: "good-password" }), (error) => {
      assert.ok(error instanceof InvalidCredentialsError);
      assert.equal(error.reason, AUTH_FAILURE_REASONS.ACCOUNT_DISABLED);
      return true;
    });
    assert.equal(deps.passwordProvider.verify.mock.callCount(), 1);
    assert.equal(deps.tokenProvider.issue.mock.callCount(), 0);
  });

  it("validates input before touching the repository", async () => {
    const invalidInputs = [
      undefined,
      null,
      "alice:pw",
      {},
      { identifier: "alice" },
      { identifier: "", password: "x" },
      { identifier: 42, password: "x" },
      // Opérateur NoSQL injecté par le client : refusé avant d'atteindre le repository.
      { identifier: { $ne: null }, password: "x" },
      { identifier: "alice", password: ["x"] },
      { identifier: "a".repeat(321), password: "x" },
      { identifier: "alice", password: "p".repeat(1025) }
    ];
    for (const credentials of invalidInputs) {
      await assert.rejects(service.login(credentials), InvalidInputError);
    }
    assert.equal(deps.users.findByIdentifier.mock.callCount(), 0);
  });

  it("wraps repository failures in a DependencyFailureError that keeps the cause", async () => {
    const failure = new Error("database unavailable");
    deps.users.findByIdentifier.mock.mockImplementation(async () => {
      throw failure;
    });
    await assert.rejects(service.login({ identifier: "alice", password: "good-password" }), (error) => {
      assert.ok(error instanceof DependencyFailureError);
      assert.equal(error.code, "DEPENDENCY_FAILURE");
      assert.equal(error.dependency, "UserRepository.findByIdentifier");
      assert.equal(error.cause, failure);
      assert.match(error.message, /L’appel à UserRepository\.findByIdentifier\(\) a échoué/);
      return true;
    });
  });

  it("wraps failures of every injected dependency, even non-Error values", async () => {
    const cases = [
      ["UserRepository.findById", () => deps.users.findById, () => service.verifyAccessToken("valid-token")],
      ["TokenProvider.verify", () => deps.tokenProvider.verify, () => service.verifyAccessToken("valid-token")],
      ["TokenProvider.issue", () => deps.tokenProvider.issue, () => service.login({ identifier: "alice", password: "good-password" })],
      ["PasswordProvider.verify", () => deps.passwordProvider.verify, () => service.login({ identifier: "alice", password: "good-password" })]
    ];
    for (const [dependency, getMock, run] of cases) {
      deps = createMocks();
      service = createAuthenticationService(deps);
      getMock().mock.mockImplementation(async () => {
        throw "plain string thrown";
      });
      await assert.rejects(run(), (error) => {
        assert.ok(error instanceof DependencyFailureError, dependency);
        assert.equal(error.dependency, dependency);
        assert.equal(error.cause, "plain string thrown");
        return true;
      });
    }
  });

  it("detects token providers returning a malformed issued token", async () => {
    deps.tokenProvider.issue.mock.mockImplementation(async () => ({ token: "t" }));
    await assert.rejects(service.login({ identifier: "alice", password: "good-password" }), (error) => {
      assert.ok(error instanceof ContractViolationError);
      assert.match(error.message, /TokenProvider\.issue\(\) doit renvoyer/);
      return true;
    });
  });

  it("reports malformed repository records as contract violations", async () => {
    deps.users.findByIdentifier.mock.mockImplementation(async () => ({ id: "u1", password: "plain" }));
    await assert.rejects(service.login({ identifier: "alice", password: "good-password" }), ContractViolationError);
  });
});

describe("AuthenticationService.verifyAccessToken", () => {
  let deps;
  let service;
  beforeEach(() => {
    deps = createMocks();
    service = createAuthenticationService(deps);
  });

  it("returns the principal for a valid token of an active user", async () => {
    const principal = await service.verifyAccessToken("valid-token");
    assert.deepEqual(principal, { userId: "u1", tokenId: "jti-1", issuedAt: 1000, expiresAt: 1900 });
    assert.ok(Object.isFrozen(principal));
    assert.deepEqual(deps.users.findById.mock.calls[0].arguments, ["u1"]);
  });

  it("reports missing tokens", async () => {
    for (const token of [undefined, null, ""]) {
      await assert.rejects(service.verifyAccessToken(token), TokenMissingError);
    }
  });

  it("rejects non-string and oversized tokens without calling the provider", async () => {
    await assert.rejects(service.verifyAccessToken(42), InvalidTokenError);
    await assert.rejects(service.verifyAccessToken("a".repeat(8193)), InvalidTokenError);
    assert.equal(deps.tokenProvider.verify.mock.callCount(), 0);
  });

  it("propagates token provider errors", async () => {
    await assert.rejects(service.verifyAccessToken("expired"), TokenExpiredError);
    await assert.rejects(service.verifyAccessToken("forged"), InvalidTokenError);
  });

  it("rejects tokens of deleted users", async () => {
    deps.users.findById.mock.mockImplementation(async () => null);
    await assert.rejects(service.verifyAccessToken("valid-token"), (error) => {
      assert.ok(error instanceof InvalidTokenError);
      assert.equal(error.reason, AUTH_FAILURE_REASONS.USER_NOT_FOUND);
      return true;
    });
  });

  it("rejects tokens of disabled users", async () => {
    deps.users.findById.mock.mockImplementation(async () => ({ id: "u1", passwordHash: "h", isActive: false }));
    await assert.rejects(service.verifyAccessToken("valid-token"), (error) => {
      assert.ok(error instanceof InvalidTokenError);
      assert.equal(error.reason, AUTH_FAILURE_REASONS.ACCOUNT_DISABLED);
      return true;
    });
  });

  it("detects repositories returning another user", async () => {
    deps.users.findById.mock.mockImplementation(async () => ({ id: "u2", passwordHash: "h", isActive: true }));
    await assert.rejects(service.verifyAccessToken("valid-token"), ContractViolationError);
  });

  it("detects token providers returning claims without subject", async () => {
    deps.tokenProvider.verify.mock.mockImplementation(async () => ({ tokenId: "x" }));
    await assert.rejects(service.verifyAccessToken("valid-token"), ContractViolationError);
  });
});

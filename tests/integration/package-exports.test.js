import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Importe la bibliothèque via son nom de paquet (auto-référence Node.js) afin
 * de tester la carte `exports` de package.json comme le feront les utilisateurs.
 */
describe("package exports", () => {
  it("exposes the documented root API", async () => {
    const root = await import("@express-authkit/core");
    assert.deepEqual(Object.keys(root).sort(), [
      "AUDIT_EVENTS",
      "AUTH_ERROR_CODES",
      "AUTH_FAILURE_REASONS",
      "AccessDeniedError",
      "AuthKitError",
      "ConfigurationError",
      "ContractViolationError",
      "DependencyFailureError",
      "InvalidCredentialsError",
      "InvalidInputError",
      "InvalidPasswordHashError",
      "InvalidRefreshTokenError",
      "InvalidTokenError",
      "TokenExpiredError",
      "TokenMissingError",
      "TooManyAttemptsError",
      "assertAttemptStore",
      "assertPasswordProvider",
      "assertRefreshTokenStore",
      "assertTokenProvider",
      "assertUserRepository",
      "createArgon2PasswordProvider",
      "createAuthKit",
      "createInMemoryAttemptStore",
      "createInMemoryRefreshTokenStore",
      "createJwtTokenProvider",
      "isAuthKitError",
      "isAuthorized",
      "isPasswordCompromised"
    ]);
  });

  it("exposes the Express adapter as a subpath", async () => {
    const adapter = await import("@express-authkit/core/express");
    assert.deepEqual(Object.keys(adapter).sort(), ["clientKeyOf", "createExpressAuth"]);
  });

  it("shares error classes between entry points", async () => {
    const root = await import("@express-authkit/core");
    const adapter = await import("@express-authkit/core/express");
    assert.throws(() => adapter.createExpressAuth({}), root.ContractViolationError);
  });

  it("does not expose internal modules", async () => {
    await assert.rejects(import("@express-authkit/core/src/core/errors.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    await assert.rejects(import("@express-authkit/core/core"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Importe la bibliothèque via son nom de paquet (auto-référence Node.js) afin
 * de tester la carte `exports` de package.json comme le feront les utilisateurs.
 */
describe("package exports", () => {
  it("exposes the documented root API", async () => {
    const root = await import("express-authkit");
    assert.deepEqual(Object.keys(root).sort(), [
      "AUTH_ERROR_CODES",
      "AUTH_FAILURE_REASONS",
      "AuthKitError",
      "ConfigurationError",
      "ContractViolationError",
      "DependencyFailureError",
      "InvalidCredentialsError",
      "InvalidInputError",
      "InvalidPasswordHashError",
      "InvalidTokenError",
      "TokenExpiredError",
      "TokenMissingError",
      "assertPasswordProvider",
      "assertTokenProvider",
      "assertUserRepository",
      "createArgon2PasswordProvider",
      "createAuthKit",
      "createJwtTokenProvider",
      "isAuthKitError"
    ]);
  });

  it("exposes the Express adapter as a subpath", async () => {
    const adapter = await import("express-authkit/express");
    assert.deepEqual(Object.keys(adapter), ["createExpressAuth"]);
  });

  it("shares error classes between entry points", async () => {
    const root = await import("express-authkit");
    const adapter = await import("express-authkit/express");
    assert.throws(() => adapter.createExpressAuth({}), root.ContractViolationError);
  });

  it("does not expose internal modules", async () => {
    await assert.rejects(import("express-authkit/src/core/errors.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    await assert.rejects(import("express-authkit/core"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  });
});

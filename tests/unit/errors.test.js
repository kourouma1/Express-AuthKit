import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTH_ERROR_CODES,
  AUTH_FAILURE_REASONS,
  AuthKitError,
  ConfigurationError,
  InvalidCredentialsError,
  InvalidTokenError,
  TokenExpiredError,
  isAuthKitError
} from "../../src/index.js";

describe("errors", () => {
  it("exposes stable, frozen error codes", () => {
    assert.ok(Object.isFrozen(AUTH_ERROR_CODES));
    assert.equal(AUTH_ERROR_CODES.INVALID_CREDENTIALS, "INVALID_CREDENTIALS");
    assert.equal(AUTH_ERROR_CODES.TOKEN_EXPIRED, "TOKEN_EXPIRED");
  });

  it("builds errors with a code, a name and a public message", () => {
    const error = new ConfigurationError("bad option");
    assert.ok(error instanceof AuthKitError);
    assert.ok(error instanceof Error);
    assert.equal(error.name, "ConfigurationError");
    assert.equal(error.code, AUTH_ERROR_CODES.INVALID_CONFIGURATION);
    assert.equal(error.message, "bad option");
    assert.ok(isAuthKitError(error));
    assert.equal(isAuthKitError(new Error("x")), false);
  });

  it("uses one generic message for every login failure reason", () => {
    const messages = Object.values(AUTH_FAILURE_REASONS).map((reason) => new InvalidCredentialsError(reason).message);
    assert.equal(new Set(messages).size, 1);
  });

  it("keeps the internal reason out of serialization", () => {
    const error = new InvalidCredentialsError(AUTH_FAILURE_REASONS.USER_NOT_FOUND);
    assert.equal(error.reason, AUTH_FAILURE_REASONS.USER_NOT_FOUND);
    assert.equal(Object.keys(error).includes("reason"), false);
    assert.equal(JSON.stringify(error).includes("USER_NOT_FOUND"), false);

    const tokenError = new InvalidTokenError({ reason: AUTH_FAILURE_REASONS.ACCOUNT_DISABLED });
    assert.equal(JSON.stringify(tokenError).includes("ACCOUNT_DISABLED"), false);
  });

  it("preserves the cause for server-side diagnostics", () => {
    const cause = new Error("jose detail");
    assert.equal(new TokenExpiredError({ cause }).cause, cause);
  });
});

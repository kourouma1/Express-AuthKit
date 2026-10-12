import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { normalizeAuthorizationRequirement } from "../../src/core/authorization.js";
import { ConfigurationError, ContractViolationError, isAuthorized } from "../../src/index.js";

/**
 * @param {{ roles?: string[], permissions?: string[] }} [authorities]
 */
function principal({ roles = [], permissions = [] } = {}) {
  return Object.freeze({ userId: "u1", tokenId: "t", issuedAt: 0, expiresAt: 1, roles, permissions });
}

describe("isAuthorized", () => {
  it("accepts a role given as a simple string", async () => {
    assert.equal(await isAuthorized(principal({ roles: ["admin"] }), "admin"), true);
    assert.equal(await isAuthorized(principal({ roles: ["editor"] }), "admin"), false);
    assert.equal(await isAuthorized(principal(), "admin"), false);
  });

  it("anyRole: at least one of the roles", async () => {
    const rule = { anyRole: ["admin", "editor"] };
    assert.equal(await isAuthorized(principal({ roles: ["editor"] }), rule), true);
    assert.equal(await isAuthorized(principal({ roles: ["viewer"] }), rule), false);
  });

  it("allPermissions: every permission is required", async () => {
    const rule = { allPermissions: ["orders:read", "orders:write"] };
    assert.equal(await isAuthorized(principal({ permissions: ["orders:read", "orders:write", "x"] }), rule), true);
    assert.equal(await isAuthorized(principal({ permissions: ["orders:read"] }), rule), false);
  });

  it("is case-sensitive: « Admin » is not « admin »", async () => {
    assert.equal(await isAuthorized(principal({ roles: ["Admin"] }), "admin"), false);
  });

  it("requires every given rule at once", async () => {
    const rule = { anyRole: ["admin"], allPermissions: ["billing:read"] };
    assert.equal(await isAuthorized(principal({ roles: ["admin"] }), rule), false);
    assert.equal(await isAuthorized(principal({ roles: ["admin"], permissions: ["billing:read"] }), rule), true);
  });

  it("calls check() last, with the principal and the context", async () => {
    const check = mock.fn(async (user, context) => user.userId === context.ownerId);
    assert.equal(await isAuthorized(principal(), { check }, { ownerId: "u1" }), true);
    assert.equal(await isAuthorized(principal(), { check }, { ownerId: "u2" }), false);
    assert.equal(check.mock.callCount(), 2);

    const skipped = mock.fn(() => true);
    assert.equal(await isAuthorized(principal(), { anyRole: ["admin"], check: skipped }), false);
    assert.equal(skipped.mock.callCount(), 0);
  });

  it("refuses non-boolean check() results instead of guessing", async () => {
    for (const result of ["yes", 1, undefined, null]) {
      await assert.rejects(isAuthorized(principal(), { check: () => result }), ContractViolationError);
    }
  });
});

describe("normalizeAuthorizationRequirement", () => {
  it("rejects invalid rules at startup", () => {
    const invalid = [
      undefined,
      null,
      "",
      "   ",
      42,
      ["admin"],
      {},
      { roles: ["admin"] },
      { anyRole: [] },
      { anyRole: "admin" },
      { anyRole: [""] },
      { allPermissions: [42] },
      { check: "yes" },
      { anyRole: ["x".repeat(129)] }
    ];
    for (const requirement of invalid) {
      assert.throws(() => normalizeAuthorizationRequirement(requirement), ConfigurationError, JSON.stringify(requirement));
    }
  });

  it("cannot be bypassed with a hand-made frozen object", async () => {
    // Une liste de rôles vide autoriserait tout le monde : elle doit être refusée.
    const forged = Object.freeze({ anyRole: Object.freeze([]), allPermissions: Object.freeze([]) });
    await assert.rejects(isAuthorized(principal(), forged), ConfigurationError);
  });
});

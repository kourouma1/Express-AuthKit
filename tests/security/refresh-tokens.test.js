import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  AUTH_FAILURE_REASONS,
  ConfigurationError,
  ContractViolationError,
  DependencyFailureError,
  InvalidInputError,
  InvalidRefreshTokenError,
  createAuthKit,
  createInMemoryRefreshTokenStore
} from "../../src/index.js";
import { FAST_ARGON2, TEST_PASSWORD, createInMemoryUserRepository, jwtOptions } from "../helpers/fixtures.js";

/**
 * Moteur réel (Argon2id + JWT) avec jetons de rafraîchissement activés.
 * Le stockage en mémoire est enveloppé pour observer ce qui y est écrit.
 */
async function createRefreshAuthKit({ store = createInMemoryRefreshTokenStore(), expiresInSeconds } = {}) {
  const saved = [];
  const observedStore = {
    save: async (record) => {
      saved.push(record);
      return store.save(record);
    },
    consume: (tokenHash) => store.consume(tokenHash),
    revokeFamily: (familyId) => store.revokeFamily(familyId),
    revokeUser: (userId) => store.revokeUser(userId)
  };
  const users = createInMemoryUserRepository();
  const auth = createAuthKit({
    users,
    jwt: jwtOptions(),
    password: FAST_ARGON2,
    refreshTokens: { store: observedStore, expiresInSeconds }
  });
  const passwordHash = await auth.password.hash(TEST_PASSWORD);
  users.users.set("user-1", { id: "user-1", email: "alice@example.test", passwordHash, isActive: true });
  users.users.set("user-2", { id: "user-2", email: "bob@example.test", passwordHash, isActive: true });
  const login = (email = "alice@example.test") => auth.login({ identifier: email, password: TEST_PASSWORD });
  return { auth, users, saved, login };
}

const rejectsWithReason = (reason) => (error) => {
  assert.ok(error instanceof InvalidRefreshTokenError, `attendu InvalidRefreshTokenError, reçu ${error?.name}`);
  assert.equal(error.code, "REFRESH_TOKEN_INVALID");
  assert.equal(error.reason, reason);
  return true;
};

describe("refresh tokens", () => {
  it("are not issued when the feature is disabled", async () => {
    const users = createInMemoryUserRepository();
    const auth = createAuthKit({ users, jwt: jwtOptions(), password: FAST_ARGON2 });
    users.users.set("u", { id: "u", email: "a@b.c", passwordHash: await auth.password.hash(TEST_PASSWORD), isActive: true });

    const result = await auth.login({ identifier: "a@b.c", password: TEST_PASSWORD });
    assert.equal("refreshToken" in result, false);
    await assert.rejects(auth.refresh("x"), (error) => error instanceof ConfigurationError && /refreshTokens/.test(error.message));
    await assert.rejects(auth.logout("x"), ConfigurationError);
    await assert.rejects(auth.revokeAllSessions("u"), ConfigurationError);
  });

  it("are issued at login: 256 random bits, and only their SHA-256 hash is stored", async () => {
    const { saved, login } = await createRefreshAuthKit();
    const result = await login();

    assert.match(result.refreshToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(result.refreshExpiresIn, 1_209_600);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].tokenHash, createHash("sha256").update(result.refreshToken).digest("hex"));
    assert.equal(JSON.stringify(saved).includes(result.refreshToken), false);
    assert.equal(saved[0].userId, "user-1");
  });

  it("rotate: refresh returns a new pair and the access token works", async () => {
    const { auth, login } = await createRefreshAuthKit();
    const first = await login();
    const second = await auth.refresh(first.refreshToken);

    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.notEqual(second.accessToken, first.accessToken);
    assert.equal((await auth.verifyAccessToken(second.accessToken)).userId, "user-1");
    const third = await auth.refresh(second.refreshToken);
    assert.ok(third.refreshToken);
  });

  it("detect reuse: replaying a used token revokes the whole family", async () => {
    const { auth, login } = await createRefreshAuthKit();
    const stolen = (await login()).refreshToken;
    const legitimate = await auth.refresh(stolen);

    // L'attaquant rejoue l'ancien jeton : vol détecté.
    await assert.rejects(auth.refresh(stolen), rejectsWithReason(AUTH_FAILURE_REASONS.REFRESH_TOKEN_REUSED));
    // Le jeton légitime de la même famille est révoqué lui aussi.
    await assert.rejects(auth.refresh(legitimate.refreshToken), rejectsWithReason(AUTH_FAILURE_REASONS.REFRESH_TOKEN_UNKNOWN));
  });

  it("keep other sessions alive when one family is revoked", async () => {
    const { auth, login } = await createRefreshAuthKit();
    const laptop = await login();
    const phone = await login();
    await auth.logout(laptop.refreshToken);

    await assert.rejects(auth.refresh(laptop.refreshToken), InvalidRefreshTokenError);
    assert.ok((await auth.refresh(phone.refreshToken)).refreshToken);
  });

  it("treat concurrent refreshes of the same token as reuse: no new token survives", async () => {
    const { auth, login } = await createRefreshAuthKit();
    const { refreshToken } = await login();
    const results = await Promise.allSettled([auth.refresh(refreshToken), auth.refresh(refreshToken)]);
    // Le second appel détecte la réutilisation et ferme la session ; le premier,
    // encore en cours, s’en aperçoit après avoir enregistré son nouveau jeton.
    assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
    for (const result of results) {
      assert.equal(/** @type {PromiseRejectedResult} */ (result).reason.code, "REFRESH_TOKEN_INVALID");
    }
  });

  it("never let a rotation in progress outlive a revocation (logout, revokeAllSessions, theft)", async () => {
    for (const revoke of ["revokeAllSessions", "logout"]) {
      const store = createInMemoryRefreshTokenStore();
      const { auth, users, login } = await createRefreshAuthKit({ store });
      const { refreshToken } = await login();
      // La révocation arrive pendant la rotation : après la consommation de
      // l’ancien jeton, avant l’enregistrement du nouveau.
      const findById = users.findById.bind(users);
      users.findById = async (id) => {
        users.findById = findById;
        await (revoke === "logout" ? auth.logout(refreshToken) : auth.revokeAllSessions(id));
        return findById(id);
      };
      const rotation = await auth.refresh(refreshToken).then((r) => r, (e) => e);
      assert.equal(rotation.code, "REFRESH_TOKEN_INVALID", `${revoke} : la rotation aurait dû échouer`);
      // Et aucun jeton émis pendant la course n’est utilisable.
      if (rotation.refreshToken) {
        await assert.rejects(auth.refresh(rotation.refreshToken));
      }
    }
  });

  it("reject unknown and expired tokens", async () => {
    const store = createInMemoryRefreshTokenStore();
    const expiringStore = {
      ...store,
      save: (record) => store.save({ ...record, expiresAt: record.expiresAt - 10_000_000 })
    };
    const { auth, login } = await createRefreshAuthKit({ store: expiringStore });

    await assert.rejects(auth.refresh("a".repeat(43)), rejectsWithReason(AUTH_FAILURE_REASONS.REFRESH_TOKEN_UNKNOWN));
    // Ce stockage enregistre les jetons avec une date d'expiration déjà passée.
    const { refreshToken } = await login();
    await assert.rejects(auth.refresh(refreshToken), rejectsWithReason(AUTH_FAILURE_REASONS.REFRESH_TOKEN_EXPIRED));
  });

  it("reject tokens of users disabled or deleted since login, and revoke the family", async () => {
    const { auth, users, login } = await createRefreshAuthKit();
    const disabled = await login();
    users.users.get("user-1").isActive = false;
    await assert.rejects(auth.refresh(disabled.refreshToken), rejectsWithReason(AUTH_FAILURE_REASONS.ACCOUNT_DISABLED));

    const deleted = await login("bob@example.test");
    users.users.delete("user-2");
    await assert.rejects(auth.refresh(deleted.refreshToken), rejectsWithReason(AUTH_FAILURE_REASONS.USER_NOT_FOUND));
  });

  it("logout is idempotent and accepts unknown tokens", async () => {
    const { auth, login } = await createRefreshAuthKit();
    const { refreshToken } = await login();
    await auth.logout(refreshToken);
    await auth.logout(refreshToken);
    await auth.logout("b".repeat(43));
    await assert.rejects(auth.refresh(refreshToken), InvalidRefreshTokenError);
  });

  it("revokeAllSessions logs a user out everywhere, without touching other users", async () => {
    const { auth, login } = await createRefreshAuthKit();
    const aliceLaptop = await login();
    const alicePhone = await login();
    const bob = await login("bob@example.test");

    await auth.revokeAllSessions("user-1");
    await assert.rejects(auth.refresh(aliceLaptop.refreshToken), InvalidRefreshTokenError);
    await assert.rejects(auth.refresh(alicePhone.refreshToken), InvalidRefreshTokenError);
    assert.ok((await auth.refresh(bob.refreshToken)).refreshToken);
    await assert.rejects(auth.revokeAllSessions({}), InvalidInputError);
  });

  it("validate refresh token input", async () => {
    const { auth } = await createRefreshAuthKit();
    for (const token of [undefined, null, "", 42, {}, "x".repeat(513)]) {
      await assert.rejects(auth.refresh(token), InvalidInputError);
      await assert.rejects(auth.logout(token), InvalidInputError);
    }
  });

  it("keep the internal reason out of serialization", async () => {
    const { auth, login } = await createRefreshAuthKit();
    const { refreshToken } = await login();
    await auth.refresh(refreshToken);
    await assert.rejects(auth.refresh(refreshToken), (error) => {
      assert.equal(JSON.stringify(error).includes("REUSED"), false);
      assert.equal(error.message, "Jeton de rafraîchissement invalide ou expiré. Reconnectez-vous.");
      return true;
    });
  });
});

describe("refresh token configuration and store contract", () => {
  const users = createInMemoryUserRepository();

  it("requires a store implementing the contract", () => {
    assert.throws(
      () => createAuthKit({ users, jwt: jwtOptions(), refreshTokens: {} }),
      (error) => error instanceof ConfigurationError && /refreshTokens\.store/.test(error.message)
    );
    assert.throws(
      () => createAuthKit({ users, jwt: jwtOptions(), refreshTokens: { store: { save() {}, consume() {} } } }),
      (error) => error instanceof ContractViolationError && /revokeFamily\(\), revokeUser\(\)/.test(error.message)
    );
  });

  it("bounds the refresh token lifetime and rejects unknown options", () => {
    const store = createInMemoryRefreshTokenStore();
    for (const expiresInSeconds of [10, 7_776_001, "14d"]) {
      assert.throws(() => createAuthKit({ users, jwt: jwtOptions(), refreshTokens: { store, expiresInSeconds } }), ConfigurationError);
    }
    assert.throws(() => createAuthKit({ users, jwt: jwtOptions(), refreshTokens: { store, ttl: 5 } }), ConfigurationError);
  });

  it("detects a store returning a malformed consume() result", async () => {
    const store = createInMemoryRefreshTokenStore();
    const { auth, login } = await createRefreshAuthKit({ store: { ...store, consume: async () => ({ userId: "user-1" }) } });
    const { refreshToken } = await login();
    await assert.rejects(auth.refresh(refreshToken), ContractViolationError);
  });

  it("wraps store failures in DependencyFailureError", async () => {
    const store = createInMemoryRefreshTokenStore();
    const failingStore = {
      ...store,
      consume: async () => {
        throw new Error("redis down");
      }
    };
    const { auth, login } = await createRefreshAuthKit({ store: failingStore });
    const { refreshToken } = await login();
    await assert.rejects(auth.refresh(refreshToken), (error) => {
      assert.ok(error instanceof DependencyFailureError);
      assert.equal(error.dependency, "RefreshTokenStore.consume");
      assert.equal(error.cause.message, "redis down");
      return true;
    });
  });
});

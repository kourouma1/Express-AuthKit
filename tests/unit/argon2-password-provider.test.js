import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConfigurationError,
  InvalidInputError,
  InvalidPasswordHashError,
  createArgon2PasswordProvider
} from "../../src/index.js";
import { FAST_ARGON2, TEST_PASSWORD } from "../helpers/fixtures.js";

describe("Argon2 password provider", () => {
  const provider = createArgon2PasswordProvider(FAST_ARGON2);

  it("produces Argon2id hashes embedding the configured parameters", async () => {
    const hash = await provider.hash(TEST_PASSWORD);
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    assert.equal(hash.includes(TEST_PASSWORD), false);
  });

  it("uses default RFC 9106 parameters when no option is given", async () => {
    const hash = await createArgon2PasswordProvider().hash(TEST_PASSWORD);
    assert.match(hash, /^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
  });

  it("salts every hash", async () => {
    const [first, second] = await Promise.all([provider.hash(TEST_PASSWORD), provider.hash(TEST_PASSWORD)]);
    assert.notEqual(first, second);
  });

  it("verifies the right password and rejects wrong ones", async () => {
    const hash = await provider.hash(TEST_PASSWORD);
    assert.equal(await provider.verify(TEST_PASSWORD, hash), true);
    assert.equal(await provider.verify("wrong password", hash), false);
    assert.equal(await provider.verify(TEST_PASSWORD.toUpperCase(), hash), false);
    assert.equal(await provider.verify(`${TEST_PASSWORD} `, hash), false);
  });

  it("handles unicode passwords", async () => {
    const hash = await provider.hash("mot de passe très sûr 🔐");
    assert.equal(await provider.verify("mot de passe très sûr 🔐", hash), true);
    assert.equal(await provider.verify("mot de passe tres sur 🔐", hash), false);
  });

  it("verifies hashes created with other cost parameters", async () => {
    const strongerHash = await createArgon2PasswordProvider({ ...FAST_ARGON2, timeCost: 3 }).hash(TEST_PASSWORD);
    assert.equal(await provider.verify(TEST_PASSWORD, strongerHash), true);
  });

  it("rejects invalid passwords as input errors", async () => {
    for (const password of ["", undefined, null, 123, "x".repeat(1025)]) {
      await assert.rejects(provider.hash(password), InvalidInputError);
      await assert.rejects(provider.verify(password, "$argon2id$v=19$m=1,t=1,p=1$a$b"), InvalidInputError);
    }
  });

  it("refuses hashes that are not Argon2id", async () => {
    const unsupported = [
      "$2b$10$abcdefghijklmnopqrstuuS2u0W/4m6OgIr9ZtQJ7kq7wXv1fH7e", // hash bcrypt
      "$argon2i$v=19$m=19456,p=1,t=2$c2FsdHNhbHQ$aGFzaA",
      "plain-text-password",
      "$argon2id$garbage",
      undefined
    ];
    for (const hash of unsupported) {
      await assert.rejects(provider.verify(TEST_PASSWORD, hash), InvalidPasswordHashError, String(hash));
    }
  });

  it("validates its options at creation", () => {
    assert.throws(() => createArgon2PasswordProvider({ memoryCost: 1024 }), ConfigurationError);
  });
});

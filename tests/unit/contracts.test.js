import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeUserRecord } from "../../src/core/contracts/user-repository.js";
import {
  ContractViolationError,
  assertPasswordProvider,
  assertTokenProvider,
  assertUserRepository,
  createAuthKit
} from "../../src/index.js";
import { createInMemoryUserRepository, jwtOptions } from "../helpers/fixtures.js";

const isContractViolation = (pattern) => (error) =>
  error instanceof ContractViolationError && error.code === "CONTRACT_VIOLATION" && pattern.test(error.message);

describe("contract assertions", () => {
  it("accept objects implementing every method", () => {
    assert.doesNotThrow(() => assertUserRepository({ findByIdentifier() {}, findById() {} }));
    assert.doesNotThrow(() => assertPasswordProvider({ hash() {}, verify() {} }));
    assert.doesNotThrow(() => assertTokenProvider({ issue() {}, verify() {} }));
  });

  it("accept class instances with prototype methods", () => {
    class PrismaUserRepository {
      async findByIdentifier() { return null; }
      async findById() { return null; }
    }
    assert.doesNotThrow(() => assertUserRepository(new PrismaUserRepository()));
  });

  it("name every missing method", () => {
    assert.throws(() => assertUserRepository({ findById() {} }), isContractViolation(/findByIdentifier\(\)/));
    assert.throws(() => assertPasswordProvider({}), isContractViolation(/hash\(\), verify\(\)/));
    assert.throws(() => assertTokenProvider({ issue: "nope", verify() {} }), isContractViolation(/issue\(\)/));
  });

  it("reject non-objects", () => {
    for (const value of [null, undefined, 42, "repo"]) {
      assert.throws(() => assertUserRepository(value), isContractViolation(/must be an object/));
    }
  });

  it("are enforced by createAuthKit at initialization", () => {
    assert.throws(() => createAuthKit({ users: {}, jwt: jwtOptions() }), isContractViolation(/UserRepository/));
    assert.throws(
      () => createAuthKit({ users: createInMemoryUserRepository(), providers: { token: { issue() {} } } }),
      isContractViolation(/TokenProvider must implement: verify\(\)/)
    );
    assert.throws(
      () => createAuthKit({ users: createInMemoryUserRepository(), jwt: jwtOptions(), providers: { password: {} } }),
      isContractViolation(/PasswordProvider/)
    );
  });
});

describe("normalizeUserRecord", () => {
  it("maps missing users to null", () => {
    assert.equal(normalizeUserRecord(null), null);
    assert.equal(normalizeUserRecord(undefined), null);
  });

  it("keeps only the fields the engine needs", () => {
    const record = normalizeUserRecord({ id: "1", passwordHash: "$argon2id$x", isActive: true, email: "a@b.c" });
    assert.deepEqual(record, { id: "1", passwordHash: "$argon2id$x", isActive: true });
  });

  it("converts integer, bigint and ObjectId identifiers to strings", () => {
    const base = { passwordHash: "h", isActive: true };
    const objectId = { toHexString: () => "65f1c0ffee0000000000abcd" };
    assert.equal(normalizeUserRecord({ ...base, id: 42 }).id, "42");
    assert.equal(normalizeUserRecord({ ...base, id: 9007199254740993n }).id, "9007199254740993");
    assert.equal(normalizeUserRecord({ ...base, id: objectId }).id, "65f1c0ffee0000000000abcd");
  });

  it("rejects malformed records explicitly", () => {
    assert.throws(() => normalizeUserRecord("user"), isContractViolation(/must resolve to an object/));
    for (const id of [undefined, "", 1.5, Number.NaN, 2 ** 60, {}, { id: 1 }]) {
      assert.throws(() => normalizeUserRecord({ id, passwordHash: "h", isActive: true }), isContractViolation(/`id`/));
    }
    assert.throws(
      () => normalizeUserRecord({ id: "1", isActive: true }),
      isContractViolation(/`passwordHash`.*include the password hash field/)
    );
    assert.throws(
      () => normalizeUserRecord({ id: "1", passwordHash: "h" }),
      isContractViolation(/`isActive`.*return `isActive: true`/)
    );
    assert.throws(
      () => normalizeUserRecord({ id: "1", passwordHash: "h", isActive: "yes" }),
      isContractViolation(/`isActive`/)
    );
  });
});

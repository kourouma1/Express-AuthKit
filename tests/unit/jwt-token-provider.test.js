import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeJwt, decodeProtectedHeader } from "jose";

import { ConfigurationError, InvalidInputError, createJwtTokenProvider } from "../../src/index.js";
import { TEST_AUDIENCE, TEST_ISSUER, jwtOptions } from "../helpers/fixtures.js";

describe("JWT token provider", () => {
  const provider = createJwtTokenProvider(jwtOptions({ expiresInSeconds: 600 }));

  it("issues a token with standard claims only", async () => {
    const before = Math.floor(Date.now() / 1000);
    const issued = await provider.issue({ subject: "user-42" });

    assert.equal(typeof issued.token, "string");
    assert.equal(issued.token.split(".").length, 3);
    assert.ok(issued.issuedAt >= before);
    assert.equal(issued.expiresAt - issued.issuedAt, 600);

    const claims = decodeJwt(issued.token);
    assert.deepEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "iss", "jti", "sub"]);
    assert.equal(claims.sub, "user-42");
    assert.equal(claims.iss, TEST_ISSUER);
    assert.equal(claims.aud, TEST_AUDIENCE);
    assert.equal(claims.jti, issued.tokenId);
    assert.deepEqual(decodeProtectedHeader(issued.token), { alg: "HS256", typ: "at+jwt" });
  });

  it("generates a unique token id each time", async () => {
    const [first, second] = await Promise.all([provider.issue({ subject: "u" }), provider.issue({ subject: "u" })]);
    assert.notEqual(first.tokenId, second.tokenId);
  });

  it("verifies its own tokens", async () => {
    const issued = await provider.issue({ subject: "user-42" });
    assert.deepEqual(await provider.verify(issued.token), {
      subject: "user-42",
      tokenId: issued.tokenId,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt
    });
  });

  it("supports HS384 and HS512 with long enough secrets", async () => {
    const secret = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(64))).toString("base64url");
    for (const algorithm of ["HS384", "HS512"]) {
      const strong = createJwtTokenProvider(jwtOptions({ secret, algorithm }));
      const issued = await strong.issue({ subject: "u" });
      assert.equal(decodeProtectedHeader(issued.token).alg, algorithm);
      assert.equal((await strong.verify(issued.token)).subject, "u");
    }
  });

  it("validates the subject when issuing", async () => {
    for (const input of [undefined, {}, { subject: "" }, { subject: 42 }, { subject: "x".repeat(257) }]) {
      await assert.rejects(provider.issue(input), InvalidInputError);
    }
  });

  it("validates its options at creation", () => {
    assert.throws(() => createJwtTokenProvider(jwtOptions({ secret: "short" })), ConfigurationError);
  });
});

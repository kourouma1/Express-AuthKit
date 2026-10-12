import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { SignJWT, UnsecuredJWT, base64url, decodeJwt } from "jose";

import { InvalidTokenError, TokenExpiredError, createJwtTokenProvider } from "../../src/index.js";
import { TEST_AUDIENCE, TEST_ISSUER, TEST_SECRET, createTestAuthKit, jwtOptions } from "../helpers/fixtures.js";

const key = new TextEncoder().encode(TEST_SECRET);
const now = () => Math.floor(Date.now() / 1000);

/**
 * Signe un jeton avec la clé de test pour permettre à chaque test d’altérer une propriété.
 * Passez `null` pour omettre une revendication.
 */
function signToken({
  claims = {},
  header = { alg: "HS256", typ: "at+jwt" },
  signingKey = key,
  subject = "user-1",
  issuer = TEST_ISSUER,
  audience = TEST_AUDIENCE,
  issuedAt = now(),
  expiresAt = now() + 600
} = {}) {
  let builder = new SignJWT(claims).setProtectedHeader(header).setJti(globalThis.crypto.randomUUID());
  if (subject !== null) builder = builder.setSubject(subject);
  if (issuer !== null) builder = builder.setIssuer(issuer);
  if (audience !== null) builder = builder.setAudience(audience);
  if (issuedAt !== null) builder = builder.setIssuedAt(issuedAt);
  if (expiresAt !== null) builder = builder.setExpirationTime(expiresAt);
  return builder.sign(signingKey);
}

describe("JWT security", () => {
  const provider = createJwtTokenProvider(jwtOptions());

  it("accepts a correctly signed token (control case)", async () => {
    assert.equal((await provider.verify(await signToken())).subject, "user-1");
  });

  it("rejects expired tokens with TOKEN_EXPIRED", async () => {
    const token = await signToken({ issuedAt: now() - 1200, expiresAt: now() - 600 });
    await assert.rejects(provider.verify(token), TokenExpiredError);
  });

  it("applies the configured clock tolerance only", async () => {
    const tolerant = createJwtTokenProvider(jwtOptions({ clockToleranceSeconds: 30 }));
    const justExpired = await signToken({ issuedAt: now() - 100, expiresAt: now() - 10 });
    assert.equal((await tolerant.verify(justExpired)).subject, "user-1");
    await assert.rejects(provider.verify(justExpired), TokenExpiredError);
  });

  it("rejects tokens issued in the future", async () => {
    const token = await signToken({ issuedAt: now() + 3600, expiresAt: now() + 7200 });
    await assert.rejects(provider.verify(token), InvalidTokenError);
  });

  it("rejects tokens signed with another key", async () => {
    const token = await signToken({ signingKey: randomBytes(32) });
    await assert.rejects(provider.verify(token), InvalidTokenError);
  });

  it("rejects tampered payloads", async () => {
    const [header, , signature] = (await signToken()).split(".");
    const forgedPayload = base64url.encode(
      JSON.stringify({ ...decodeJwt(await signToken()), sub: "admin" })
    );
    await assert.rejects(provider.verify(`${header}.${forgedPayload}.${signature}`), InvalidTokenError);
  });

  it("rejects tampered signatures", async () => {
    const token = await signToken();
    // Modifie un caractère au milieu : le dernier peut ne contenir que des bits de remplissage.
    const position = token.length - 10;
    const replacement = token[position] === "A" ? "B" : "A";
    const tampered = token.slice(0, position) + replacement + token.slice(position + 1);
    await assert.rejects(provider.verify(tampered), InvalidTokenError);
  });

  it("rejects unsigned tokens (alg: none)", async () => {
    const token = new UnsecuredJWT({})
      .setSubject("user-1")
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("10m")
      .setJti("x")
      .encode();
    await assert.rejects(provider.verify(token), InvalidTokenError);
  });

  it("rejects algorithms outside the allowlist, even with the right key", async () => {
    const token = await signToken({ header: { alg: "HS512", typ: "at+jwt" }, signingKey: key });
    await assert.rejects(provider.verify(token), InvalidTokenError);
  });

  it("rejects JWTs that are not access tokens (typ header)", async () => {
    for (const header of [{ alg: "HS256" }, { alg: "HS256", typ: "JWT" }]) {
      await assert.rejects(provider.verify(await signToken({ header })), InvalidTokenError);
    }
  });

  it("rejects a wrong issuer or audience", async () => {
    await assert.rejects(provider.verify(await signToken({ issuer: "evil-api" })), InvalidTokenError);
    await assert.rejects(provider.verify(await signToken({ audience: "other-client" })), InvalidTokenError);
  });

  it("rejects tokens missing mandatory claims", async () => {
    for (const missing of ["subject", "issuer", "audience", "issuedAt", "expiresAt"]) {
      await assert.rejects(provider.verify(await signToken({ [missing]: null })), InvalidTokenError, missing);
    }
  });

  it("rejects malformed tokens", async () => {
    const malformed = ["abc", "a.b", "a.b.c", "....", "eyJhbGciOiJIUzI1NiJ9.e30.", "🙂.🙂.🙂", "x".repeat(9000)];
    for (const token of malformed) {
      await assert.rejects(provider.verify(token), InvalidTokenError, token.slice(0, 20));
    }
  });

  it("never writes sensitive data into issued tokens", async () => {
    const { auth } = await createTestAuthKit();
    const { accessToken } = await auth.login({ identifier: "alice@example.test", password: "correct horse battery staple" });
    const payload = JSON.stringify(decodeJwt(accessToken));
    assert.equal(payload.includes("correct horse"), false);
    assert.equal(payload.includes("argon2"), false);
    assert.equal(payload.includes("alice@example.test"), false);
  });
});

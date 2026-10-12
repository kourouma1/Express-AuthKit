import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractBearerToken } from "../../src/adapters/express/bearer-token.js";
import { InvalidTokenError, TokenMissingError } from "../../src/index.js";

describe("extractBearerToken", () => {
  it("extracts a bearer token, case-insensitively on the scheme", () => {
    assert.equal(extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(extractBearerToken("bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(extractBearerToken("BEARER  abc-_.~+/="), "abc-_.~+/=");
  });

  it("treats absent headers and other schemes as a missing token", () => {
    for (const header of [undefined, "", "   ", "Basic dXNlcjpwYXNz", "Token abc", "Bearerabc"]) {
      assert.throws(() => extractBearerToken(header), TokenMissingError, String(header));
    }
  });

  it("rejects malformed bearer values", () => {
    for (const header of ["Bearer", "Bearer ", "Bearer a b", "Bearer abc,def", "Bearer <script>", "Bearer abc\u0000"]) {
      assert.throws(() => extractBearerToken(header), InvalidTokenError, JSON.stringify(header));
    }
  });

  it("rejects oversized headers before parsing", () => {
    assert.throws(() => extractBearerToken(`Bearer ${"a".repeat(9000)}`), InvalidTokenError);
  });
});

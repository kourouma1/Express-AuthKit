import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UNKNOWN_CLIENT_KEY, clientKeyOf } from "../../src/adapters/express/client-key.js";

describe("clientKeyOf", () => {
  it("keeps IPv4 addresses and unwraps IPv4-mapped IPv6", () => {
    assert.equal(clientKeyOf({ ip: "203.0.113.7" }), "203.0.113.7");
    assert.equal(clientKeyOf({ ip: "::ffff:203.0.113.7" }), "203.0.113.7");
  });

  it("groups IPv6 addresses by /64 so a client cannot rotate addresses", () => {
    const a = clientKeyOf({ ip: "2001:db8:85a3:12:8a2e:370:7334:1" });
    const b = clientKeyOf({ ip: "2001:DB8:85A3:0012::ffff" });
    assert.equal(a, "2001:db8:85a3:12::/64");
    assert.equal(a, b);
    assert.notEqual(a, clientKeyOf({ ip: "2001:db8:85a3:13::1" }));
    assert.equal(clientKeyOf({ ip: "fe80::1%eth0" }), "fe80:0:0:0::/64");
  });

  it("falls back to the socket address, then to one shared bucket", () => {
    assert.equal(clientKeyOf({ socket: { remoteAddress: "198.51.100.4" } }), "198.51.100.4");
    // Connexion déjà fermée (req.ip indéfini) : un seul compteur partagé, jamais « pas de limite ».
    assert.equal(clientKeyOf({}), UNKNOWN_CLIENT_KEY);
    assert.equal(clientKeyOf({ socket: {} }), UNKNOWN_CLIENT_KEY);
  });

  it("normalizes every IPv6 notation and rejects malformed addresses", () => {
    const cases = {
      "::ffff:c000:201": "192.0.2.1",
      "::FFFF:192.0.2.1": "192.0.2.1",
      "2001:0DB8:0000:0000:abcd::1": "2001:db8:0:0::/64",
      "::1": "0:0:0:0::/64",
      "fe80::1%eth0": "fe80:0:0:0::/64",
      "64:ff9b::192.0.2.1": "64:ff9b:0:0::/64",
      "a::b::c": UNKNOWN_CLIENT_KEY,
      "1:2:3:4:5:6:7:8:9": UNKNOWN_CLIENT_KEY,
      "203.0.113.7, 10.0.0.1": UNKNOWN_CLIENT_KEY,
      "[::1]": UNKNOWN_CLIENT_KEY,
      "": UNKNOWN_CLIENT_KEY
    };
    for (const [ip, expected] of Object.entries(cases)) {
      assert.equal(clientKeyOf({ ip }), expected, ip);
    }
  });
});

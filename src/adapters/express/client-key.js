import { isIP } from "node:net";

/**
 * Clé utilisée quand l'adresse du client est inconnue ou illisible (connexion
 * déjà fermée, en-tête `X-Forwarded-For` invalide…). Ces requêtes partagent
 * un seul compteur : ne pas avoir d'adresse ne permet pas d'échapper à la limite.
 */
export const UNKNOWN_CLIENT_KEY = "unknown";

/**
 * Clé du client pour la limitation des tentatives : son adresse IP.
 *
 * - Une adresse IPv4 présentée en IPv6 (`::ffff:192.0.2.1` ou `::ffff:c000:201`)
 *   est ramenée à sa forme IPv4.
 * - Une adresse IPv6 est réduite à son réseau /64 : un même client obtient souvent
 *   tout un bloc /64 et pourrait sinon changer d'adresse à chaque essai.
 *
 * Derrière un proxy ou un load balancer, configurez `app.set("trust proxy", …)`
 * pour que `req.ip` soit l'adresse du client et non celle du proxy.
 *
 * @param {import("express").Request} req
 * @returns {string} Jamais vide : {@link UNKNOWN_CLIENT_KEY} si l'adresse est inconnue.
 */
export function clientKeyOf(req) {
  const raw = typeof req.ip === "string" ? req.ip : req.socket?.remoteAddress;
  const ip = typeof raw === "string" ? raw.split("%")[0] : "";
  switch (isIP(ip)) {
    case 4:
      return ip;
    case 6:
      return ipv6Key(expandIpv6(ip));
    default:
      return UNKNOWN_CLIENT_KEY;
  }
}

/**
 * @param {number[]} groups Les 8 groupes de 16 bits d'une adresse IPv6.
 * @returns {string}
 */
function ipv6Key(groups) {
  const isIpv4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isIpv4Mapped) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/**
 * Développe une adresse IPv6 déjà validée par `isIP()` (forme compressée `::`,
 * IPv4 finale `::ffff:1.2.3.4` comprises).
 *
 * @param {string} ip
 * @returns {number[]}
 */
function expandIpv6(ip) {
  let address = ip.toLowerCase();
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const [a, b, c, d] = address.slice(lastColon + 1).split(".").map(Number);
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : new Array(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((group) => Number.parseInt(group, 16));
}

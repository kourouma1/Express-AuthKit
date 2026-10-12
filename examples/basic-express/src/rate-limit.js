import { createHash } from "node:crypto";

import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Crée les deux limiteurs appliqués à la route de connexion :
 *
 * 1. Par adresse IP : freine une machine qui essaie beaucoup de comptes.
 * 2. Par identifiant : freine les attaques réparties sur de nombreuses IP
 *    contre un même compte. Les connexions réussies ne sont pas comptées.
 *
 * Par défaut, les compteurs sont en mémoire : ils ne sont PAS partagés entre
 * plusieurs instances Node.js. Passez `createStore` (voir createRedisStoreFactory)
 * pour une architecture distribuée.
 *
 * @param {object} [options]
 * @param {(prefix: string) => import("express-rate-limit").Store} [options.createStore]
 * @param {number} [options.perIpLimit]
 * @param {number} [options.perIdentifierLimit]
 * @returns {import("express").RequestHandler[]}
 */
export function createLoginRateLimiters({ createStore, perIpLimit = 20, perIdentifierLimit = 5 } = {}) {
  const common = {
    windowMs: FIFTEEN_MINUTES_MS,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      res.status(options.statusCode).json({
        error: { code: "TOO_MANY_REQUESTS", message: "Too many login attempts. Try again later." }
      });
    }
  };

  const perIp = rateLimit({
    ...common,
    limit: perIpLimit,
    // ipKeyGenerator regroupe les adresses IPv6 par sous-réseau /56.
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    store: createStore?.("login-ip:")
  });

  const perIdentifier = rateLimit({
    ...common,
    limit: perIdentifierLimit,
    skipSuccessfulRequests: true,
    // L'identifiant est haché : aucune adresse e-mail n'est stockée dans le store.
    keyGenerator: (req) => hashIdentifier(req.body?.identifier),
    store: createStore?.("login-id:")
  });

  return [perIp, perIdentifier];
}

/**
 * Store Redis partagé par toutes les instances de l'application.
 * Chaque limiteur reçoit son propre préfixe (express-rate-limit interdit de
 * réutiliser le même store pour deux limiteurs).
 *
 * @param {string} redisUrl
 * @returns {Promise<{ createStore: (prefix: string) => import("express-rate-limit").Store, close: () => Promise<void> }>}
 */
export async function createRedisStoreFactory(redisUrl) {
  // Imports dynamiques : Redis n'est chargé que si REDIS_URL est défini.
  const { createClient } = await import("redis");
  const { RedisStore } = await import("rate-limit-redis");

  const client = createClient({ url: redisUrl });
  await client.connect();

  return {
    createStore: (prefix) =>
      new RedisStore({ sendCommand: (...args) => client.sendCommand(args), prefix: `rl:${prefix}` }),
    close: () => client.close()
  };
}

/**
 * @param {unknown} identifier
 * @returns {string}
 */
function hashIdentifier(identifier) {
  const normalized = typeof identifier === "string" ? identifier.trim().toLowerCase() : "";
  return createHash("sha256").update(normalized).digest("base64url");
}

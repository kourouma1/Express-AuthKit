import { assertIntegerInRange, assertKnownKeys, assertPlainObject } from "../config/assertions.js";

const DEFAULT_MAX_ENTRIES = 100_000;

/**
 * Stockage des compteurs de tentatives en mémoire (utilisé par défaut).
 *
 * ⚠️ Les compteurs ne sont pas partagés entre plusieurs processus ou serveurs :
 * avec 3 instances, un attaquant dispose de 3 fois plus d’essais. En production
 * multi-instances, fournissez un stockage partagé (Redis, base de données),
 * voir docs/limitation-des-tentatives.md.
 *
 * Mémoire bornée : au-delà de `maxEntries` compteurs actifs (environ 15 Mo pour
 * 100 000), les plus anciens sont oubliés. Un attaquant capable de créer autant
 * de compteurs (des dizaines de milliers d’adresses IP) peut donc effacer un
 * blocage plus tôt que prévu ; c’est préférable à une mémoire illimitée.
 *
 * @param {{ maxEntries?: number }} [options] `maxEntries` : nombre maximal de compteurs (100 000 par défaut).
 * @returns {import("../core/contracts/attempt-store.js").AttemptStore}
 * @throws {import("../core/errors.js").ConfigurationError}
 */
export function createInMemoryAttemptStore(options = {}) {
  assertPlainObject(options, "createInMemoryAttemptStore(options)");
  assertKnownKeys(options, ["maxEntries"], "createInMemoryAttemptStore(options)");
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  assertIntegerInRange(maxEntries, "maxEntries", 1, 10_000_000);

  // Map triée par ordre d’insertion, c’est-à-dire par date de création du
  // compteur : les plus anciens, donc les premiers à expirer, sont en tête.
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const counters = new Map();
  const now = () => Date.now() / 1000;

  /** Retire les compteurs expirés en tête : coût proportionnel au nombre retiré. */
  function purgeExpired() {
    const t = now();
    for (const [key, counter] of counters) {
      if (counter.resetAt > t) break;
      counters.delete(key);
    }
  }

  return Object.freeze({
    async hit(key, windowSeconds) {
      purgeExpired();
      let counter = counters.get(key);
      if (counter !== undefined && counter.resetAt <= now()) {
        counters.delete(key);
        counter = undefined;
      }
      if (counter === undefined) {
        if (counters.size >= maxEntries) {
          counters.delete(/** @type {string} */ (counters.keys().next().value));
        }
        counter = { count: 0, resetAt: now() + windowSeconds };
        counters.set(key, counter);
      }
      counter.count += 1;
      return { ...counter };
    },
    async reset(key) {
      counters.delete(key);
    },
  });
}

import { assertIntegerInRange, assertKnownKeys, assertPlainObject } from "./assertions.js";
import { ARGON2_DEFAULTS, ARGON2_LIMITS } from "./defaults.js";

/**
 * Paramètres de coût Argon2id acceptés dans `createAuthKit({ password })`.
 *
 * @typedef {object} PasswordOptions
 * @property {number} [memoryCost=65536] Mémoire en Kio (minimum 19 456, soit 19 Mio).
 * @property {number} [timeCost=3] Nombre d’itérations (minimum 2).
 * @property {number} [parallelism=4] Niveau de parallélisme (1 à 16).
 */

/**
 * @typedef {Readonly<Required<PasswordOptions>>} ResolvedPasswordOptions
 */

const ALLOWED_KEYS = Object.freeze(["memoryCost", "timeCost", "parallelism"]);

/**
 * Valide les options Argon2id et refuse les paramètres sous le seuil OWASP.
 *
 * @param {unknown} [options]
 * @returns {ResolvedPasswordOptions}
 * @throws {import("../core/errors.js").ConfigurationError}
 */
export function resolvePasswordOptions(options = {}) {
  assertPlainObject(options, "password");
  assertKnownKeys(options, ALLOWED_KEYS, "password");

  const memoryCost = options.memoryCost ?? ARGON2_DEFAULTS.memoryCost;
  const timeCost = options.timeCost ?? ARGON2_DEFAULTS.timeCost;
  const parallelism = options.parallelism ?? ARGON2_DEFAULTS.parallelism;
  assertIntegerInRange(memoryCost, "password.memoryCost", ARGON2_LIMITS.minMemoryCost, ARGON2_LIMITS.maxMemoryCost);
  assertIntegerInRange(timeCost, "password.timeCost", ARGON2_LIMITS.minTimeCost, ARGON2_LIMITS.maxTimeCost);
  assertIntegerInRange(parallelism, "password.parallelism", ARGON2_LIMITS.minParallelism, ARGON2_LIMITS.maxParallelism);

  return Object.freeze({ memoryCost, timeCost, parallelism });
}

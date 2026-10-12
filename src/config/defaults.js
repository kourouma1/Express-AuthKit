/**
 * Valeurs sûres par défaut et limites acceptées.
 *
 * @module config/defaults
 */

/**
 * Algorithmes JWT acceptés pour une signature par secret partagé, avec la taille
 * minimale de clé exigée par la RFC 7518 §3.2.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const JWT_ALGORITHM_MIN_KEY_BYTES = Object.freeze({
  HS256: 32,
  HS384: 48,
  HS512: 64
});

export const JWT_DEFAULTS = Object.freeze({
  algorithm: "HS256",
  /** 15 minutes : une courte durée réduit l’impact d’un jeton divulgué. */
  expiresInSeconds: 900,
  clockToleranceSeconds: 0
});

export const JWT_LIMITS = Object.freeze({
  minExpiresInSeconds: 30,
  /** Les jetons d’accès ne sont pas révocables : une durée de plus d’un jour est refusée. */
  maxExpiresInSeconds: 86_400,
  maxClockToleranceSeconds: 60,
  maxClaimLength: 256
});

/**
 * Valeurs Argon2id par défaut : « deuxième option recommandée » de la RFC 9106
 * (64 Mio, t=3, p=4), plus forte que le minimum OWASP.
 */
export const ARGON2_DEFAULTS = Object.freeze({
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4
});

/**
 * Seuils en dessous desquels Argon2id est refusé : au moins 19 Mio de mémoire
 * et 2 itérations, selon OWASP.
 */
export const ARGON2_LIMITS = Object.freeze({
  minMemoryCost: 19_456,
  maxMemoryCost: 4_194_304,
  minTimeCost: 2,
  maxTimeCost: 20,
  minParallelism: 1,
  maxParallelism: 16
});

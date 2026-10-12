import { ConfigurationError } from "../core/errors.js";
import {
  assertIntegerInRange,
  assertKnownKeys,
  assertNonEmptyString,
  assertPlainObject
} from "./assertions.js";
import { JWT_ALGORITHM_MIN_KEY_BYTES, JWT_DEFAULTS, JWT_LIMITS } from "./defaults.js";
import { assertStrongSecret } from "./secret-strength.js";

/**
 * Options acceptées dans `createAuthKit({ jwt })`.
 *
 * @typedef {object} JwtOptions
 * @property {string | Uint8Array} secret Clé de signature partagée produite par un générateur sûr (≥ 32 octets pour HS256).
 * @property {string} issuer Valeur de la revendication `iss`, contrôlée à la vérification.
 * @property {string} audience Valeur de la revendication `aud`, contrôlée à la vérification.
 * @property {number} [expiresInSeconds=900] Durée de vie du jeton (30 à 86 400 secondes).
 * @property {"HS256" | "HS384" | "HS512"} [algorithm="HS256"] Seul algorithme accepté à la vérification.
 * @property {number} [clockToleranceSeconds=0] Décalage d’horloge accepté entre instances (0 à 60 secondes).
 */

/**
 * Paramètres JWT validés. Le secret est converti une seule fois en octets.
 *
 * @typedef {Readonly<{
 *   key: Uint8Array,
 *   issuer: string,
 *   audience: string,
 *   expiresInSeconds: number,
 *   algorithm: string,
 *   clockToleranceSeconds: number
 * }>} ResolvedJwtOptions
 */

const ALLOWED_KEYS = Object.freeze([
  "secret",
  "issuer",
  "audience",
  "expiresInSeconds",
  "algorithm",
  "clockToleranceSeconds"
]);

/**
 * Valide les options JWT, applique des valeurs sûres et refuse les valeurs dangereuses.
 *
 * @param {unknown} options
 * @returns {ResolvedJwtOptions}
 * @throws {ConfigurationError}
 */
export function resolveJwtOptions(options) {
  assertPlainObject(options, "jwt");
  assertKnownKeys(options, ALLOWED_KEYS, "jwt");

  const algorithm = options.algorithm ?? JWT_DEFAULTS.algorithm;
  if (!Object.hasOwn(JWT_ALGORITHM_MIN_KEY_BYTES, algorithm)) {
    throw new ConfigurationError(
      `\`jwt.algorithm\` must be one of: ${Object.keys(JWT_ALGORITHM_MIN_KEY_BYTES).join(", ")}.`
    );
  }

  const key = assertStrongSecret(options.secret, JWT_ALGORITHM_MIN_KEY_BYTES[algorithm]);

  assertNonEmptyString(options.issuer, "jwt.issuer", JWT_LIMITS.maxClaimLength);
  assertNonEmptyString(options.audience, "jwt.audience", JWT_LIMITS.maxClaimLength);

  const expiresInSeconds = options.expiresInSeconds ?? JWT_DEFAULTS.expiresInSeconds;
  assertIntegerInRange(
    expiresInSeconds,
    "jwt.expiresInSeconds",
    JWT_LIMITS.minExpiresInSeconds,
    JWT_LIMITS.maxExpiresInSeconds
  );

  const clockToleranceSeconds = options.clockToleranceSeconds ?? JWT_DEFAULTS.clockToleranceSeconds;
  assertIntegerInRange(clockToleranceSeconds, "jwt.clockToleranceSeconds", 0, JWT_LIMITS.maxClockToleranceSeconds);

  return Object.freeze({
    key,
    issuer: options.issuer,
    audience: options.audience,
    expiresInSeconds,
    algorithm,
    clockToleranceSeconds
  });
}

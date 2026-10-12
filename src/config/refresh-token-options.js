import { assertRefreshTokenStore } from "../core/contracts/refresh-token-store.js";
import { ConfigurationError } from "../core/errors.js";
import { DEVELOPER_MESSAGES } from "../core/messages.js";
import { assertIntegerInRange, assertKnownKeys, assertPlainObject } from "./assertions.js";
import { REFRESH_TOKEN_DEFAULTS, REFRESH_TOKEN_LIMITS } from "./defaults.js";

/**
 * Options acceptées dans `createAuthKit({ refreshTokens })`.
 *
 * @typedef {object} RefreshTokenOptions
 * @property {import("../core/contracts/refresh-token-store.js").RefreshTokenStore} store
 *   Stockage des jetons (votre base de données, ou `createInMemoryRefreshTokenStore()` en développement).
 * @property {number} [expiresInSeconds=1209600] Durée de vie d’un jeton de rafraîchissement
 *   (14 jours par défaut, de 5 minutes à 90 jours). Chaque rotation repart de zéro.
 */

/**
 * @typedef {Readonly<{
 *   store: import("../core/contracts/refresh-token-store.js").RefreshTokenStore,
 *   expiresInSeconds: number
 * }>} ResolvedRefreshTokenOptions
 */

const ALLOWED_KEYS = Object.freeze(["store", "expiresInSeconds"]);

/**
 * @param {unknown} options
 * @returns {ResolvedRefreshTokenOptions}
 * @throws {ConfigurationError | import("../core/errors.js").ContractViolationError}
 */
export function resolveRefreshTokenOptions(options) {
  assertPlainObject(options, "refreshTokens");
  assertKnownKeys(options, ALLOWED_KEYS, "refreshTokens");

  if (options.store === undefined || options.store === null) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.refreshStoreRequired);
  }
  assertRefreshTokenStore(options.store);

  const expiresInSeconds = options.expiresInSeconds ?? REFRESH_TOKEN_DEFAULTS.expiresInSeconds;
  assertIntegerInRange(
    expiresInSeconds,
    "refreshTokens.expiresInSeconds",
    REFRESH_TOKEN_LIMITS.minExpiresInSeconds,
    REFRESH_TOKEN_LIMITS.maxExpiresInSeconds
  );

  return Object.freeze({ store: options.store, expiresInSeconds });
}

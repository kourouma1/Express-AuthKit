import { assertAttemptStore } from "../core/contracts/attempt-store.js";
import { ConfigurationError } from "../core/errors.js";
import { DEVELOPER_MESSAGES } from "../core/messages.js";
import { assertIntegerInRange, assertKnownKeys, assertPlainObject } from "./assertions.js";
import { LOGIN_ATTEMPT_DEFAULTS, LOGIN_ATTEMPT_LIMITS } from "./defaults.js";

/**
 * Options acceptées dans `createAuthKit({ loginAttempts })`.
 * `false` désactive la limitation (déconseillé, sauf si elle est assurée ailleurs).
 *
 * @typedef {object} LoginAttemptOptions
 * @property {import("../core/contracts/attempt-store.js").AttemptStore} [store]
 *   Stockage des compteurs. En mémoire par défaut (un seul processus) ; partagé
 *   (Redis, base de données) dès qu'il y a plusieurs instances.
 * @property {number} [maxFailuresPerIdentifier=5] Échecs avant blocage temporaire d'un compte.
 * @property {number} [maxAttemptsPerClient=20] Tentatives maximales par client (adresse IP) et par fenêtre.
 * @property {number} [windowSeconds=900] Durée de la fenêtre de comptage, ouverte à la première tentative (60 s à 24 h).
 *   Un compte bloqué l’est jusqu’à la fin de cette fenêtre.
 */

/**
 * @typedef {Readonly<Required<LoginAttemptOptions>>} ResolvedLoginAttemptOptions
 */

const ALLOWED_KEYS = Object.freeze(["store", "maxFailuresPerIdentifier", "maxAttemptsPerClient", "windowSeconds"]);

/**
 * @param {LoginAttemptOptions | false | undefined} options
 * @param {() => import("../core/contracts/attempt-store.js").AttemptStore} createDefaultStore
 *   Stockage utilisé quand aucun n'est fourni (fourni par la factory).
 * @returns {ResolvedLoginAttemptOptions | null} `null` si la limitation est désactivée.
 * @throws {ConfigurationError | import("../core/errors.js").ContractViolationError}
 */
export function resolveLoginAttemptOptions(options, createDefaultStore) {
  if (options === false) {
    return null;
  }
  const value = options ?? {};
  assertPlainObject(value, "loginAttempts");
  assertKnownKeys(value, ALLOWED_KEYS, "loginAttempts");

  const store = value.store === undefined ? createDefaultStore() : value.store;
  if (store === null || typeof store !== "object") {
    throw new ConfigurationError(DEVELOPER_MESSAGES.attemptStoreRequired);
  }
  assertAttemptStore(store);

  /**
   * @param {"maxFailuresPerIdentifier" | "maxAttemptsPerClient" | "windowSeconds"} key
   * @returns {number}
   */
  const integer = (key) => {
    const v = value[key] ?? LOGIN_ATTEMPT_DEFAULTS[key];
    const [min, max] = LOGIN_ATTEMPT_LIMITS[key];
    assertIntegerInRange(v, `loginAttempts.${key}`, min, max);
    return v;
  };
  return Object.freeze({
    store,
    maxFailuresPerIdentifier: integer("maxFailuresPerIdentifier"),
    maxAttemptsPerClient: integer("maxAttemptsPerClient"),
    windowSeconds: integer("windowSeconds")
  });
}

import { ContractViolationError } from "../errors.js";
import { DEVELOPER_MESSAGES } from "../messages.js";
import { assertImplements } from "./assert-contract.js";

/**
 * Jeton de rafraîchissement tel qu’il est enregistré. Le jeton lui-même n’est
 * jamais stocké : seule son empreinte SHA-256 l’est. Une fuite de la base ne
 * donne donc aucun jeton utilisable.
 *
 * @typedef {object} RefreshTokenRecord
 * @property {string} tokenHash Empreinte SHA-256 du jeton (64 caractères hexadécimaux). Clé unique.
 * @property {string} userId Identifiant de l’utilisateur.
 * @property {string} familyId Identifiant de la « famille » : tous les jetons issus d’une même connexion.
 * @property {number} expiresAt Date d’expiration, en secondes depuis l’époque Unix.
 */

/**
 * Résultat de {@link RefreshTokenStore.consume}.
 *
 * @typedef {object} ConsumedRefreshToken
 * @property {string} userId
 * @property {string} familyId
 * @property {number} expiresAt Secondes depuis l’époque Unix.
 * @property {boolean} alreadyUsed `true` si le jeton avait déjà été consommé avant cet appel.
 */

/**
 * Stockage des jetons de rafraîchissement, implémenté par l’application.
 *
 * @typedef {object} RefreshTokenStore
 * @property {(record: RefreshTokenRecord) => Promise<void>} save
 *   Enregistre un nouveau jeton.
 * @property {(tokenHash: string) => Promise<ConsumedRefreshToken | null | undefined>} consume
 *   Marque le jeton comme utilisé et renvoie son état précédent, ou `null` s’il
 *   est inconnu. Doit être **atomique** : si deux requêtes consomment le même
 *   jeton en même temps, une seule doit obtenir `alreadyUsed: false`.
 *   Les jetons utilisés doivent être conservés jusqu’à leur expiration, pour
 *   détecter une réutilisation. Un jeton en cours de révocation ne doit jamais
 *   être renvoyé comme présent (avec SQL : `SELECT … FOR SHARE`).
 * @property {(familyId: string) => Promise<void>} revokeFamily
 *   Supprime tous les jetons d’une famille, utilisés ou non : `consume()` doit
 *   ensuite renvoyer `null` pour chacun d’eux.
 * @property {(userId: string) => Promise<void>} revokeUser
 *   Supprime tous les jetons d’un utilisateur, utilisés ou non : `consume()` doit
 *   ensuite renvoyer `null` pour chacun d’eux.
 */

/** @type {readonly string[]} */
export const REFRESH_TOKEN_STORE_METHODS = Object.freeze(["save", "consume", "revokeFamily", "revokeUser"]);

/**
 * @param {unknown} store
 * @returns {asserts store is RefreshTokenStore}
 * @throws {ContractViolationError}
 */
export function assertRefreshTokenStore(store) {
  assertImplements(store, "RefreshTokenStore", REFRESH_TOKEN_STORE_METHODS);
}

/**
 * Valide à l’exécution la valeur renvoyée par `consume()`.
 *
 * @param {unknown} result
 * @returns {ConsumedRefreshToken | null}
 * @throws {ContractViolationError}
 */
export function normalizeConsumedRefreshToken(result) {
  if (result === null || result === undefined) {
    return null;
  }
  const { userId, familyId, expiresAt, alreadyUsed } = /** @type {Record<string, unknown>} */ (result);
  const isValid =
    typeof userId === "string" &&
    userId.length > 0 &&
    typeof familyId === "string" &&
    familyId.length > 0 &&
    Number.isFinite(expiresAt) &&
    typeof alreadyUsed === "boolean";
  if (!isValid) {
    throw new ContractViolationError(DEVELOPER_MESSAGES.refreshStoreConsumeInvalid);
  }
  return { userId, familyId, expiresAt: /** @type {number} */ (expiresAt), alreadyUsed };
}

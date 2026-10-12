import { ContractViolationError } from "../errors.js";
import { DEVELOPER_MESSAGES } from "../messages.js";
import { assertImplements } from "./assert-contract.js";

/**
 * Compteur de tentatives sur une fenêtre de temps.
 *
 * @typedef {object} AttemptCounter
 * @property {number} count Nombre de tentatives dans la fenêtre en cours.
 * @property {number} resetAt Fin de la fenêtre, en secondes depuis l’époque Unix.
 */

/**
 * Stockage des compteurs de tentatives de connexion.
 *
 * Les clés reçues sont déjà hachées : aucun e-mail ni adresse IP n’y apparaît en clair.
 *
 * @typedef {object} AttemptStore
 * @property {(key: string, windowSeconds: number) => Promise<AttemptCounter>} hit
 *   Ajoute une tentative et renvoie le compteur à jour. Doit être **atomique**
 *   (plusieurs serveurs peuvent incrémenter la même clé en même temps). La fenêtre
 *   démarre à la première tentative et le compteur repart de zéro à son expiration.
 * @property {(key: string) => Promise<void>} reset
 *   Remet le compteur à zéro (après une connexion réussie).
 */

/** @type {readonly string[]} */
export const ATTEMPT_STORE_METHODS = Object.freeze(["hit", "reset"]);

/**
 * @param {unknown} store
 * @returns {asserts store is AttemptStore}
 */
export function assertAttemptStore(store) {
  assertImplements(store, "AttemptStore", ATTEMPT_STORE_METHODS);
}

/** Décalage d’horloge toléré entre l’application et le stockage (Redis, base de données). */
const CLOCK_SKEW_SECONDS = 60;

/**
 * Valide le compteur renvoyé par `hit()`. Une fin de fenêtre plus lointaine que
 * la fenêtre elle-même trahit un stockage défectueux (le plus souvent : des
 * millisecondes au lieu de secondes), qui bloquerait les comptes pour des années.
 *
 * @param {unknown} value
 * @param {number} windowSeconds
 * @returns {AttemptCounter}
 * @throws {ContractViolationError}
 */
export function normalizeAttemptCounter(value, windowSeconds) {
  const { count, resetAt } = /** @type {Record<string, unknown>} */ (value ?? {});
  const isValid =
    typeof count === "number" &&
    Number.isInteger(count) &&
    count >= 1 &&
    typeof resetAt === "number" &&
    Number.isFinite(resetAt) &&
    resetAt <= Date.now() / 1000 + windowSeconds + CLOCK_SKEW_SECONDS;
  if (!isValid) {
    throw new ContractViolationError(DEVELOPER_MESSAGES.attemptStoreResultInvalid);
  }
  return { count, resetAt };
}

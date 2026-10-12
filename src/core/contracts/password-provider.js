import { assertImplements } from "./assert-contract.js";

/**
 * Contrat de hachage des mots de passe.
 *
 * Les implémentations doivent employer un algorithme éprouvé (le fournisseur
 * par défaut utilise Argon2id) et ne jamais programmer la cryptographie elles-mêmes.
 *
 * @typedef {object} PasswordProvider
 * @property {(password: string) => Promise<string>} hash
 *   Renvoie un hash autonome (algorithme, paramètres et sel encodés dans la chaîne).
 * @property {(password: string, hash: string) => Promise<boolean>} verify
 *   Renvoie `true` si le mot de passe correspond. La comparaison doit être en
 *   temps constant et lever `InvalidPasswordHashError` si `hash` est illisible.
 * @property {(hash: string) => boolean | Promise<boolean>} [needsRehash]
 *   Facultatif. Renvoie `true` si le hash a été produit avec des paramètres dépassés
 *   (coûts plus faibles, ancien algorithme) : il est alors recalculé à la connexion.
 */

/** @type {readonly string[]} */
export const PASSWORD_PROVIDER_METHODS = Object.freeze(["hash", "verify"]);

/**
 * @param {unknown} provider
 * @returns {asserts provider is PasswordProvider}
 * @throws {import("../errors.js").ContractViolationError}
 */
export function assertPasswordProvider(provider) {
  assertImplements(provider, "PasswordProvider", PASSWORD_PROVIDER_METHODS);
}

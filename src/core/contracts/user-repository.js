import { ContractViolationError } from "../errors.js";
import { DEVELOPER_MESSAGES } from "../messages.js";
import { assertImplements } from "./assert-contract.js";

/**
 * Données utilisateur minimales attendues par le moteur. Le dépôt transforme
 * son modèle (ligne SQL, document Mongo, réponse d’API…) dans ce format.
 *
 * Les propriétés supplémentaires sont autorisées et ignorées. Elles ne sont
 * jamais copiées dans les jetons ni dans le principal authentifié.
 *
 * @typedef {object} AuthUserRecord
 * @property {string | number | bigint | { toHexString(): string }} id Identifiant stable, unique et non secret (chaîne, entier ou ObjectId MongoDB) ; converti en chaîne, il devient la revendication JWT `sub`.
 * @property {string} passwordHash Hash Argon2id produit par `auth.password.hash()`.
 * @property {boolean} isActive Doit valoir exactement `true` pour autoriser la connexion.
 */

/**
 * Contrat de persistance implémenté par l’application.
 *
 * Les deux méthodes doivent renvoyer `null` (ou `undefined`) lorsqu’aucun
 * utilisateur ne correspond. Elles ne doivent pas lever d’erreur dans ce cas ;
 * les erreurs sont réservées aux problèmes d’infrastructure.
 *
 * @typedef {object} UserRepository
 * @property {(identifier: string) => Promise<AuthUserRecord | null | undefined>} findByIdentifier
 *   Cherche un utilisateur par identifiant de connexion (e-mail, nom…). La
 *   normalisation (minuscules, espaces) relève de la responsabilité du dépôt.
 * @property {(id: string) => Promise<AuthUserRecord | null | undefined>} findById
 *   Cherche un utilisateur par l’identifiant contenu dans la revendication `sub`.
 */

/** @type {readonly string[]} */
export const USER_REPOSITORY_METHODS = Object.freeze(["findByIdentifier", "findById"]);

/**
 * Vérifie qu’un dépôt injecté respecte le contrat {@link UserRepository}.
 *
 * @param {unknown} repository
 * @returns {asserts repository is UserRepository}
 * @throws {ContractViolationError}
 */
export function assertUserRepository(repository) {
  assertImplements(repository, "UserRepository", USER_REPOSITORY_METHODS);
}

/**
 * Valide à l’exécution une donnée renvoyée par le dépôt.
 *
 * Une donnée mal formée est une erreur de programmation. Elle lève donc
 * {@link ContractViolationError} au lieu d’être traitée comme un échec de
 * connexion, ce qui masquerait le problème.
 *
 * @param {unknown} record
 * @returns {AuthUserRecord | null}
 * @throws {ContractViolationError}
 */
export function normalizeUserRecord(record) {
  if (record === null || record === undefined) {
    return null;
  }
  if (typeof record !== "object") {
    throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryRecordNotObject);
  }

  const { passwordHash, isActive } = /** @type {Record<string, unknown>} */ (record);
  const id = normalizeUserId(/** @type {Record<string, unknown>} */ (record).id);
  if (typeof passwordHash !== "string" || passwordHash.length === 0) {
    throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryRecordPasswordHash);
  }
  if (typeof isActive !== "boolean") {
    throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryRecordIsActive);
  }

  return { id, passwordHash, isActive };
}

/**
 * Accepte les formes d’identifiant les plus courantes et les convertit en
 * chaîne : texte, entier auto-incrémenté (SQL), BigInt et ObjectId MongoDB.
 * La conversion est sans perte, ce qui évite aux applications de l’écrire.
 *
 * @param {unknown} id
 * @returns {string}
 * @throws {ContractViolationError}
 */
function normalizeUserId(id) {
  if (typeof id === "string" && id.length > 0) {
    return id;
  }
  if ((typeof id === "number" && Number.isSafeInteger(id)) || typeof id === "bigint") {
    return String(id);
  }
  if (id !== null && typeof id === "object" && typeof id.toHexString === "function") {
    return id.toHexString();
  }
  throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryRecordId);
}

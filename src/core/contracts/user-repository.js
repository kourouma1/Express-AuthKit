import { ContractViolationError } from "../errors.js";
import { MAX_AUTHORITIES, MAX_AUTHORITY_LENGTH } from "../input-limits.js";
import { DEVELOPER_MESSAGES, repositoryRecordAuthorities } from "../messages.js";
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
 * @property {string[]} [roles] Rôles de l’utilisateur (par exemple `["admin"]`). Facultatif.
 * @property {string[]} [permissions] Permissions de l’utilisateur (par exemple `["orders:write"]`). Facultatif.
 */

/**
 * Enregistrement validé et normalisé, utilisé par le moteur.
 *
 * @typedef {{
 *   id: string,
 *   passwordHash: string,
 *   isActive: boolean,
 *   roles: readonly string[],
 *   permissions: readonly string[]
 * }} NormalizedUserRecord
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
 * @property {(id: string, passwordHash: string) => Promise<void>} [updatePasswordHash]
 *   Facultatif. Enregistre un nouveau hash : permet de moderniser automatiquement les
 *   hash dépassés lors d’une connexion réussie (voir `PasswordProvider.needsRehash`).
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
 * @returns {NormalizedUserRecord | null} Enregistrement avec un `id` toujours en texte.
 * @throws {ContractViolationError}
 */
export function normalizeUserRecord(record) {
  if (record === null || record === undefined) {
    return null;
  }
  if (typeof record !== "object") {
    throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryRecordNotObject);
  }

  const { passwordHash, isActive, roles, permissions } = /** @type {Record<string, unknown>} */ (record);
  const id = normalizeUserId(/** @type {Record<string, unknown>} */ (record).id);
  if (typeof passwordHash !== "string" || passwordHash.length === 0) {
    throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryRecordPasswordHash);
  }
  if (typeof isActive !== "boolean") {
    throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryRecordIsActive);
  }

  return {
    id,
    passwordHash,
    isActive,
    roles: normalizeAuthorities(roles, "roles"),
    permissions: normalizeAuthorities(permissions, "permissions")
  };
}

/**
 * Valide une liste de rôles ou de permissions. Absente, elle vaut une liste
 * vide : un utilisateur sans rôle n’obtient aucun accès protégé par rôle.
 *
 * @param {unknown} value
 * @param {string} field
 * @returns {readonly string[]} Liste figée, sans doublons.
 * @throws {ContractViolationError}
 */
function normalizeAuthorities(value, field) {
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }
  const isValid =
    Array.isArray(value) &&
    value.length <= MAX_AUTHORITIES &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.length <= MAX_AUTHORITY_LENGTH);
  if (!isValid) {
    throw new ContractViolationError(repositoryRecordAuthorities(field, MAX_AUTHORITIES, MAX_AUTHORITY_LENGTH));
  }
  return Object.freeze([...new Set(/** @type {string[]} */ (value))]);
}

/**
 * Accepte les formes d’identifiant les plus courantes et les convertit en
 * chaîne : texte, entier auto-incrémenté (SQL), BigInt et ObjectId MongoDB.
 * La conversion est sans perte, ce qui évite aux applications de l’écrire.
 *
 * @param {unknown} id
 * @returns {string | null} L’identifiant en texte, ou `null` si sa forme n’est pas prise en charge.
 */
export function toUserIdString(id) {
  if (typeof id === "string" && id.length > 0) {
    return id;
  }
  if ((typeof id === "number" && Number.isSafeInteger(id)) || typeof id === "bigint") {
    return String(id);
  }
  if (id !== null && typeof id === "object") {
    const { toHexString } = /** @type {{ toHexString?: unknown }} */ (id);
    if (typeof toHexString === "function") {
      return String(toHexString.call(id));
    }
  }
  return null;
}

/**
 * @param {unknown} id
 * @returns {string}
 * @throws {ContractViolationError}
 */
function normalizeUserId(id) {
  const normalized = toUserIdString(id);
  if (normalized === null) {
    throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryRecordId);
  }
  return normalized;
}

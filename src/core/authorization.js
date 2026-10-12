import { ConfigurationError, ContractViolationError } from "./errors.js";
import { MAX_AUTHORITY_LENGTH } from "./input-limits.js";
import { DEVELOPER_MESSAGES } from "./messages.js";

/**
 * Règle d’accès.
 *
 * Un simple texte désigne un rôle : `"admin"` équivaut à `{ anyRole: ["admin"] }`.
 * Quand plusieurs règles sont données, **toutes** doivent être respectées.
 *
 * @typedef {string | {
 *   anyRole?: string[],
 *   allPermissions?: string[],
 *   check?: (principal: import("./contracts/auth-principal.js").AuthPrincipal, context?: unknown) => boolean | Promise<boolean>
 * }} AuthorizationRequirement
 */

/**
 * Règle validée, prête à être évaluée.
 *
 * @typedef {Readonly<{
 *   anyRole: readonly string[],
 *   allPermissions: readonly string[],
 *   check: ((principal: import("./contracts/auth-principal.js").AuthPrincipal, context?: unknown) => boolean | Promise<boolean>) | undefined
 * }>} NormalizedAuthorizationRequirement
 */

const ALLOWED_KEYS = Object.freeze(["anyRole", "allPermissions", "check"]);

/**
 * Règles produites par normalizeAuthorizationRequirement(). Un registre
 * interne, plutôt qu’un test sur la forme de l’objet : un objet fabriqué à la
 * main (par exemple avec une liste de rôles vide) ne peut pas se faire passer
 * pour une règle validée et contourner la validation.
 *
 * @type {WeakSet<object>}
 */
const normalizedRequirements = new WeakSet();

/**
 * Valide une règle d’accès au démarrage, pour qu’une faute (rôle vide, clé
 * mal orthographiée…) soit signalée avant la première requête.
 *
 * @param {unknown} requirement
 * @returns {NormalizedAuthorizationRequirement}
 * @throws {ConfigurationError}
 */
export function normalizeAuthorizationRequirement(requirement) {
  if (typeof requirement === "string") {
    return register({ anyRole: Object.freeze([assertAuthorityName(requirement)]), allPermissions: Object.freeze([]), check: undefined });
  }
  if (requirement === null || typeof requirement !== "object" || Array.isArray(requirement)) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.authorizeRequirementInvalid);
  }

  const rules = /** @type {Record<string, unknown>} */ (requirement);
  const hasUnknownKey = Object.keys(rules).some((key) => !ALLOWED_KEYS.includes(key));
  const hasAtLeastOneRule = ALLOWED_KEYS.some((key) => rules[key] !== undefined);
  if (hasUnknownKey || !hasAtLeastOneRule) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.authorizeRequirementInvalid);
  }
  if (rules.check !== undefined && typeof rules.check !== "function") {
    throw new ConfigurationError(DEVELOPER_MESSAGES.authorizeRequirementInvalid);
  }

  return register({
    anyRole: normalizeNameList(rules.anyRole),
    allPermissions: normalizeNameList(rules.allPermissions),
    check: /** @type {NormalizedAuthorizationRequirement["check"]} */ (rules.check)
  });
}

/**
 * Indique si un utilisateur authentifié respecte une règle d’accès.
 *
 * - `anyRole` : l’utilisateur doit avoir **au moins un** de ces rôles ;
 * - `allPermissions` : il doit avoir **toutes** ces permissions ;
 * - `check` : fonction personnalisée, appelée en dernier, avec `context`
 *   (la requête HTTP avec l’adaptateur Express).
 *
 * @example
 * await isAuthorized(principal, "admin");
 * await isAuthorized(principal, { allPermissions: ["orders:write"] });
 * await isAuthorized(principal, { check: (user, req) => user.userId === req.params.id }, req);
 *
 * @param {import("./contracts/auth-principal.js").AuthPrincipal} principal
 * @param {AuthorizationRequirement | NormalizedAuthorizationRequirement} requirement
 * @param {unknown} [context] Information transmise à `check` (par exemple la requête).
 * @returns {Promise<boolean>}
 * @throws {ConfigurationError} Si la règle est invalide.
 * @throws {ContractViolationError} Si `check` ne renvoie pas un booléen.
 */
export async function isAuthorized(principal, requirement, context) {
  const rules = isNormalized(requirement) ? requirement : normalizeAuthorizationRequirement(requirement);

  if (rules.anyRole.length > 0 && !rules.anyRole.some((role) => principal.roles.includes(role))) {
    return false;
  }
  if (!rules.allPermissions.every((permission) => principal.permissions.includes(permission))) {
    return false;
  }
  if (rules.check === undefined) {
    return true;
  }

  const allowed = await rules.check(principal, context);
  if (typeof allowed !== "boolean") {
    // Refuser silencieusement masquerait un bug ; accepter une valeur « vraie »
    // ouvrirait l’accès par erreur. On signale donc le problème.
    throw new ContractViolationError(DEVELOPER_MESSAGES.authorizationCheckNotBoolean);
  }
  return allowed;
}

/**
 * @param {NormalizedAuthorizationRequirement} rules
 * @returns {NormalizedAuthorizationRequirement}
 */
function register(rules) {
  const frozen = Object.freeze(rules);
  normalizedRequirements.add(frozen);
  return frozen;
}

/**
 * @param {unknown} requirement
 * @returns {requirement is NormalizedAuthorizationRequirement}
 */
function isNormalized(requirement) {
  return typeof requirement === "object" && requirement !== null && normalizedRequirements.has(requirement);
}

/**
 * @param {unknown} value
 * @returns {readonly string[]}
 */
function normalizeNameList(value) {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.authorizeRequirementInvalid);
  }
  return Object.freeze(value.map(assertAuthorityName));
}

/**
 * @param {unknown} name
 * @returns {string}
 */
function assertAuthorityName(name) {
  if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_AUTHORITY_LENGTH) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.authorizeRequirementInvalid);
  }
  return name;
}

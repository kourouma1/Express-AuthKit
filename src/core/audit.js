import { DEVELOPER_MESSAGES } from "./messages.js";

/**
 * Types d’événements d’audit. Ils font partie de l’API publique.
 *
 * @readonly
 * @enum {string}
 */
export const AUDIT_EVENTS = Object.freeze({
  LOGIN_SUCCEEDED: "login.succeeded",
  LOGIN_FAILED: "login.failed",
  LOGIN_BLOCKED: "login.blocked",
  ACCOUNT_LOCKED: "account.locked",
  TOKEN_REJECTED: "token.rejected",
  ACCESS_DENIED: "access.denied",
  REFRESH_SUCCEEDED: "refresh.succeeded",
  REFRESH_REJECTED: "refresh.rejected",
  REFRESH_REUSE_DETECTED: "refresh.reuse_detected",
  LOGOUT: "logout",
  SESSIONS_REVOKED: "sessions.revoked",
  PASSWORD_REHASHED: "password.rehashed",
  PASSWORD_REHASH_FAILED: "password.rehash_failed",
});

/**
 * Événement d’audit. Ne contient jamais de mot de passe, de hash ni de jeton.
 *
 * @typedef {object} AuditEvent
 * @property {string} type Voir {@link AUDIT_EVENTS}.
 * @property {string} at Date ISO 8601.
 * @property {string} [userId] Utilisateur concerné, quand il est connu.
 * @property {string} [identifier] Identifiant saisi à la connexion (donnée personnelle : e-mail…).
 * @property {string} [client] Client à l’origine de la requête (adresse IP), quand il est connu.
 * @property {string} [reason] Raison détaillée (`INVALID_PASSWORD`, `ACCOUNT_DISABLED`…).
 * @property {number} [retryAfterSeconds] Durée d’un blocage.
 * @property {string} [scope] Portée d’un blocage : `identifier` ou `client`.
 * @property {unknown} [error] Erreur d’origine, pour `password.rehash_failed`.
 * @property {string} [method] Méthode HTTP, pour `access.denied`.
 * @property {string} [path] Chemin de la requête (sans paramètres de requête), pour `access.denied`.
 */

/**
 * Symbole interne : permet à l’adaptateur Express d’émettre des événements
 * (accès refusé) sans élargir l’API publique du moteur. Volontairement absent
 * du registre global (`Symbol.for`) : un autre code ne peut pas forger d’événements.
 */
export const AUDIT_EMITTER = Symbol("express-authkit.audit");

/**
 * Crée l’émetteur d’événements d’audit.
 *
 * Le gestionnaire est appelé sans que sa promesse soit attendue : un journal
 * asynchrone lent ou en panne ne ralentit ni ne bloque l’authentification (un
 * gestionnaire **synchrone** lent, lui, la ralentit). Ses erreurs ne sont pas
 * ignorées en silence : elles sont signalées par un avertissement Node.js
 * (`process.emitWarning`), visible dans la console et interceptable.
 *
 * @param {((event: AuditEvent) => unknown) | undefined} hook
 * @returns {(type: string, details?: Record<string, unknown>) => void}
 */
export function createAuditEmitter(hook) {
  if (hook === undefined) {
    return () => {};
  }
  /** @param {unknown} error */
  const report = (error) => emitLibraryWarning(DEVELOPER_MESSAGES.auditHookFailed, "EXPRESS_AUTHKIT_AUDIT", error);
  return (type, details = {}) => {
    const event = Object.freeze({ type, at: new Date().toISOString(), ...withoutUndefined(details) });
    try {
      const result = /** @type {{ then?: unknown } | undefined} */ (hook(event));
      if (typeof result?.then === "function") {
        /** @type {PromiseLike<unknown>} */ (result).then(undefined, report);
      }
    } catch (error) {
      report(error);
    }
  };
}

/** @param {Record<string, unknown>} details */
function withoutUndefined(details) {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

/**
 * Avertissement Node.js (`process.emitWarning`) : le seul canal par lequel la
 * bibliothèque signale un problème sans le transmettre au client HTTP. Ne lève
 * jamais d’erreur, même si l’erreur décrite est impossible à convertir en texte.
 *
 * @param {string} message
 * @param {string} code
 * @param {unknown} [error]
 */
export function emitLibraryWarning(message, code, error) {
  try {
    globalThis.process?.emitWarning?.(message, { code, detail: error === undefined ? undefined : describe(error) });
  } catch {
    // Un avertissement ne doit jamais interrompre l’authentification.
  }
}

/** @param {unknown} error */
function describe(error) {
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

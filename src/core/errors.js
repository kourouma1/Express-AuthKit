/**
 * Types d’erreurs structurées pour Express AuthKit.
 *
 * Chaque erreur expose un `code` stable, utilisable par les applications.
 * Ces codes font partie de l’API publique. Le cœur n’associe jamais les
 * erreurs à des statuts HTTP : c’est le rôle des adaptateurs.
 *
 * @module core/errors
 */

import { DEVELOPER_MESSAGES, PUBLIC_MESSAGES, dependencyFailed } from "./messages.js";

/**
 * Codes d’erreur stables exposés par la bibliothèque.
 *
 * @readonly
 * @enum {string}
 */
export const AUTH_ERROR_CODES = Object.freeze({
  /** Échec de connexion, volontairement générique pour éviter l’énumération des comptes. */
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  /** Donnée invalide (mauvais type, vide ou trop longue). */
  INVALID_INPUT: "INVALID_INPUT",
  /** Aucun jeton d’accès n’a été fourni. */
  TOKEN_MISSING: "TOKEN_MISSING",
  /** Le jeton est mal formé, altéré, signé avec une autre clé ou contient des revendications invalides. */
  TOKEN_INVALID: "TOKEN_INVALID",
  /** La signature du jeton est valide, mais le jeton a expiré. */
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  /** Le moteur est configuré avec des options manquantes ou non sûres. */
  INVALID_CONFIGURATION: "INVALID_CONFIGURATION",
  /** Une dépendance injectée ne respecte pas son contrat. */
  CONTRACT_VIOLATION: "CONTRACT_VIOLATION",
  /** Le fournisseur de mots de passe ne peut pas lire un hash stocké. */
  INVALID_PASSWORD_HASH: "INVALID_PASSWORD_HASH",
  /** Le jeton de rafraîchissement est inconnu, expiré, déjà utilisé ou révoqué. */
  REFRESH_TOKEN_INVALID: "REFRESH_TOKEN_INVALID",
  /** Une dépendance injectée (repository, provider) a échoué de façon inattendue. */
  DEPENDENCY_FAILURE: "DEPENDENCY_FAILURE"
});

/**
 * Raisons internes associées aux échecs d’authentification.
 *
 * Elles servent uniquement à l’audit côté serveur et ne doivent jamais être
 * envoyées au client, car elles révéleraient l’existence d’un compte.
 *
 * @readonly
 * @enum {string}
 */
export const AUTH_FAILURE_REASONS = Object.freeze({
  USER_NOT_FOUND: "USER_NOT_FOUND",
  INVALID_PASSWORD: "INVALID_PASSWORD",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  /** Jeton de rafraîchissement absent du stockage (jamais émis, ou révoqué). */
  REFRESH_TOKEN_UNKNOWN: "REFRESH_TOKEN_UNKNOWN",
  /** Jeton de rafraîchissement expiré. */
  REFRESH_TOKEN_EXPIRED: "REFRESH_TOKEN_EXPIRED",
  /** Jeton de rafraîchissement déjà utilisé : vol probable, toute la famille est révoquée. */
  REFRESH_TOKEN_REUSED: "REFRESH_TOKEN_REUSED"
});

/**
 * Classe de base de toutes les erreurs levées par Express AuthKit.
 */
export class AuthKitError extends Error {
  /**
   * @param {string} code Code d’erreur stable (voir {@link AUTH_ERROR_CODES}).
   * @param {string} message Message pouvant être exposé aux clients de l’API.
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    /** @type {string} */
    this.code = code;
  }

  /**
   * Représentation sûre pour les journaux et `JSON.stringify()` : ni pile
   * d’appels, ni cause, ni raison interne.
   *
   * @returns {{ name: string, code: string, message: string }}
   */
  toJSON() {
    return { name: this.name, code: this.code, message: this.message };
  }
}

/**
 * Échec de connexion. Le message public ne précise jamais la cause.
 */
export class InvalidCredentialsError extends AuthKitError {
  /**
   * @param {string} [reason] Raison d’audit interne (voir {@link AUTH_FAILURE_REASONS}).
   */
  constructor(reason) {
    super(AUTH_ERROR_CODES.INVALID_CREDENTIALS, PUBLIC_MESSAGES.invalidCredentials);
    // Non énumérable pour éviter une fuite accidentelle dans une réponse HTTP.
    Object.defineProperty(this, "reason", { value: reason, enumerable: false });
  }
}

/**
 * Donnée structurellement invalide reçue à une frontière de confiance.
 */
export class InvalidInputError extends AuthKitError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(AUTH_ERROR_CODES.INVALID_INPUT, message);
  }
}

/**
 * Jeton d’accès absent de la requête.
 */
export class TokenMissingError extends AuthKitError {
  constructor() {
    super(AUTH_ERROR_CODES.TOKEN_MISSING, PUBLIC_MESSAGES.tokenMissing);
  }
}

/**
 * Jeton d’accès rejeté (mal formé, altéré, mauvais émetteur ou audience, utilisateur inconnu ou désactivé…).
 */
export class InvalidTokenError extends AuthKitError {
  /**
   * @param {{ cause?: unknown, reason?: string }} [options]
   */
  constructor(options = {}) {
    super(AUTH_ERROR_CODES.TOKEN_INVALID, PUBLIC_MESSAGES.tokenInvalid, { cause: options.cause });
    Object.defineProperty(this, "reason", { value: options.reason, enumerable: false });
  }
}

/**
 * Jeton d’accès dont la signature est valide, mais qui a expiré.
 */
export class TokenExpiredError extends AuthKitError {
  /**
   * @param {{ cause?: unknown }} [options]
   */
  constructor(options = {}) {
    super(AUTH_ERROR_CODES.TOKEN_EXPIRED, PUBLIC_MESSAGES.tokenExpired, options);
  }
}

/**
 * Jeton de rafraîchissement refusé. Le message public est toujours le même ;
 * la cause précise est dans `reason` (non énumérable), pour les journaux.
 */
export class InvalidRefreshTokenError extends AuthKitError {
  /**
   * @param {string} [reason] Raison d’audit interne (voir {@link AUTH_FAILURE_REASONS}).
   */
  constructor(reason) {
    super(AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID, PUBLIC_MESSAGES.refreshTokenInvalid);
    Object.defineProperty(this, "reason", { value: reason, enumerable: false });
  }
}

/**
 * Configuration manquante, mal formée ou non sûre, levée à l’initialisation.
 */
export class ConfigurationError extends AuthKitError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(AUTH_ERROR_CODES.INVALID_CONFIGURATION, message);
  }
}

/**
 * Dépendance injectée qui n’implémente pas son contrat.
 */
export class ContractViolationError extends AuthKitError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(AUTH_ERROR_CODES.CONTRACT_VIOLATION, message);
  }
}

/**
 * Hash de mot de passe stocké que le fournisseur ne peut pas lire. Cela vient
 * généralement d’une migration de données (par exemple bcrypt avec Argon2).
 */
export class InvalidPasswordHashError extends AuthKitError {
  /**
   * @param {{ cause?: unknown }} [options]
   */
  constructor(options = {}) {
    super(AUTH_ERROR_CODES.INVALID_PASSWORD_HASH, DEVELOPER_MESSAGES.unsupportedPasswordHash, options);
  }
}

/**
 * Échec inattendu d’une dépendance injectée : base de données indisponible,
 * service distant en panne, bug dans un provider personnalisé…
 *
 * L’erreur d’origine est conservée dans `cause` pour le diagnostic. Elle n’est
 * jamais exposée aux clients HTTP par l’adaptateur Express.
 */
export class DependencyFailureError extends AuthKitError {
  /**
   * @param {string} dependency Nom de l’appel qui a échoué, par exemple « UserRepository.findById ».
   * @param {unknown} cause Erreur d’origine.
   */
  constructor(dependency, cause) {
    super(AUTH_ERROR_CODES.DEPENDENCY_FAILURE, dependencyFailed(dependency), { cause });
    /** @type {string} */
    this.dependency = dependency;
  }
}

/**
 * Exécute l’appel à une dépendance injectée. Les erreurs de la bibliothèque
 * (jeton expiré, hash illisible…) sont transmises telles quelles ; toute autre
 * erreur est enveloppée dans une {@link DependencyFailureError}.
 *
 * @template T
 * @param {string} dependency
 * @param {() => Promise<T> | T} call
 * @returns {Promise<T>}
 */
export async function callDependency(dependency, call) {
  try {
    return await call();
  } catch (error) {
    throw isAuthKitError(error) ? error : new DependencyFailureError(dependency, error);
  }
}

/**
 * Garde de type pour les erreurs levées par Express AuthKit.
 *
 * @param {unknown} error
 * @returns {error is AuthKitError}
 */
export function isAuthKitError(error) {
  return error instanceof AuthKitError;
}

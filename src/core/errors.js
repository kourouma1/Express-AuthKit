/**
 * Types d’erreurs structurées pour Express AuthKit.
 *
 * Chaque erreur expose un `code` stable, utilisable par les applications.
 * Ces codes font partie de l’API publique. Le cœur n’associe jamais les
 * erreurs à des statuts HTTP : c’est le rôle des adaptateurs.
 *
 * @module core/errors
 */

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
  INVALID_PASSWORD_HASH: "INVALID_PASSWORD_HASH"
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
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED"
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
}

/**
 * Échec de connexion. Le message public ne précise jamais la cause.
 */
export class InvalidCredentialsError extends AuthKitError {
  /**
   * @param {string} [reason] Raison d’audit interne (voir {@link AUTH_FAILURE_REASONS}).
   */
  constructor(reason) {
    super(AUTH_ERROR_CODES.INVALID_CREDENTIALS, "Invalid credentials.");
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
    super(AUTH_ERROR_CODES.TOKEN_MISSING, "Authentication required.");
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
    super(AUTH_ERROR_CODES.TOKEN_INVALID, "Invalid access token.", { cause: options.cause });
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
    super(AUTH_ERROR_CODES.TOKEN_EXPIRED, "Access token expired.", options);
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
    super(AUTH_ERROR_CODES.INVALID_PASSWORD_HASH, "Stored password hash is not supported.", options);
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

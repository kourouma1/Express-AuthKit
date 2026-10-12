import { createAuthPrincipal } from "./contracts/auth-principal.js";
import { normalizeUserRecord } from "./contracts/user-repository.js";
import {
  AUTH_FAILURE_REASONS,
  ContractViolationError,
  InvalidCredentialsError,
  InvalidInputError,
  InvalidTokenError,
  TokenMissingError
} from "./errors.js";
import { MAX_IDENTIFIER_LENGTH, MAX_PASSWORD_LENGTH, MAX_TOKEN_LENGTH } from "./input-limits.js";

/**
 * @typedef {import("./contracts/user-repository.js").UserRepository} UserRepository
 * @typedef {import("./contracts/password-provider.js").PasswordProvider} PasswordProvider
 * @typedef {import("./contracts/token-provider.js").TokenProvider} TokenProvider
 * @typedef {import("./contracts/authentication-service.js").AuthenticationService} AuthenticationService
 * @typedef {import("./contracts/authentication-service.js").LoginCredentials} LoginCredentials
 * @typedef {import("./contracts/authentication-service.js").LoginResult} LoginResult
 * @typedef {import("./contracts/auth-principal.js").AuthPrincipal} AuthPrincipal
 */

/**
 * Crée le service d’authentification indépendant du framework.
 *
 * La fabrique doit avoir validé les dépendances au préalable. Ce service ne
 * conserve aucun état utilisateur : il peut être partagé entre les requêtes
 * et entre plusieurs processus derrière un répartiteur de charge.
 *
 * @param {object} dependencies
 * @param {UserRepository} dependencies.users
 * @param {PasswordProvider} dependencies.passwordProvider
 * @param {TokenProvider} dependencies.tokenProvider
 * @returns {AuthenticationService}
 */
export function createAuthenticationService({ users, passwordProvider, tokenProvider }) {
  const getDummyHash = createDummyHashSource(passwordProvider);

  /**
   * @param {LoginCredentials} credentials
   * @returns {Promise<LoginResult>}
   */
  async function login(credentials) {
    const { identifier, password } = validateCredentials(credentials);

    const user = normalizeUserRecord(await users.findByIdentifier(identifier));

    if (user === null) {
      // Réduit les fuites de temps : vérifie aussi un faux hash pour que les
      // comptes inconnus coûtent autant qu’un compte existant.
      await passwordProvider.verify(password, await getDummyHash());
      throw new InvalidCredentialsError(AUTH_FAILURE_REASONS.USER_NOT_FOUND);
    }

    // Vérifie volontairement le mot de passe avant le statut du compte :
    // un compte désactivé prend alors le même temps qu’un compte actif.
    const passwordMatches = await passwordProvider.verify(password, user.passwordHash);
    if (passwordMatches !== true) {
      throw new InvalidCredentialsError(AUTH_FAILURE_REASONS.INVALID_PASSWORD);
    }
    if (user.isActive !== true) {
      throw new InvalidCredentialsError(AUTH_FAILURE_REASONS.ACCOUNT_DISABLED);
    }

    const issued = await tokenProvider.issue({ subject: user.id });
    return {
      accessToken: issued.token,
      tokenType: "Bearer",
      expiresIn: issued.expiresAt - issued.issuedAt,
      principal: createAuthPrincipal(issued, user.id)
    };
  }

  /**
   * @param {string} token
   * @returns {Promise<AuthPrincipal>}
   */
  async function verifyAccessToken(token) {
    if (token === undefined || token === null || token === "") {
      throw new TokenMissingError();
    }
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
      throw new InvalidTokenError();
    }

    const claims = await tokenProvider.verify(token);
    if (typeof claims?.subject !== "string" || claims.subject.length === 0) {
      throw new ContractViolationError("TokenProvider.verify() must resolve to claims with a non-empty `subject`.");
    }

    // Vérifier l’utilisateur à chaque requête bloque immédiatement les
    // comptes supprimés ou désactivés, ce qu’un JWT seul ne peut pas faire.
    const user = normalizeUserRecord(await users.findById(claims.subject));
    if (user === null) {
      throw new InvalidTokenError({ reason: AUTH_FAILURE_REASONS.USER_NOT_FOUND });
    }
    if (user.id !== claims.subject) {
      throw new ContractViolationError("UserRepository.findById() returned a user with a different `id`.");
    }
    if (user.isActive !== true) {
      throw new InvalidTokenError({ reason: AUTH_FAILURE_REASONS.ACCOUNT_DISABLED });
    }

    return createAuthPrincipal(claims, user.id);
  }

  return Object.freeze({ login, verifyAccessToken });
}

/**
 * @param {unknown} credentials
 * @returns {LoginCredentials}
 * @throws {InvalidInputError}
 */
function validateCredentials(credentials) {
  if (credentials === null || typeof credentials !== "object") {
    throw new InvalidInputError("Credentials must be an object with `identifier` and `password`.");
  }
  const { identifier, password } = /** @type {Record<string, unknown>} */ (credentials);
  assertBoundedString(identifier, "identifier", MAX_IDENTIFIER_LENGTH);
  assertBoundedString(password, "password", MAX_PASSWORD_LENGTH);
  return { identifier, password };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLength
 * @returns {asserts value is string}
 */
function assertBoundedString(value, field, maxLength) {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidInputError(`\`${field}\` must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new InvalidInputError(`\`${field}\` must not exceed ${maxLength} characters.`);
  }
}

/**
 * Calcule puis met en cache, à la demande, le hash d’une valeur aléatoire avec
 * le fournisseur configuré. Son coût correspond ainsi à celui d’un vrai hash.
 * Un essai en erreur n’est pas mis en cache.
 *
 * @param {PasswordProvider} passwordProvider
 * @returns {() => Promise<string>}
 */
function createDummyHashSource(passwordProvider) {
  /** @type {Promise<string> | undefined} */
  let pending;
  return () => {
    pending ??= passwordProvider.hash(globalThis.crypto.randomUUID()).catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

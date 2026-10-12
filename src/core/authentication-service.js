import { createAuthPrincipal } from "./contracts/auth-principal.js";
import { normalizeUserRecord } from "./contracts/user-repository.js";
import {
  AUTH_FAILURE_REASONS,
  ContractViolationError,
  InvalidCredentialsError,
  InvalidInputError,
  InvalidTokenError,
  TokenMissingError,
  callDependency
} from "./errors.js";
import { MAX_IDENTIFIER_LENGTH, MAX_PASSWORD_LENGTH, MAX_TOKEN_LENGTH } from "./input-limits.js";
import { DEVELOPER_MESSAGES, PUBLIC_MESSAGES, fieldRequired, fieldTooLong } from "./messages.js";

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

  // Chaque appel à une dépendance injectée est enveloppé : une panne (base de
  // données indisponible, bug d’un provider) devient une DependencyFailureError
  // avec un code stable, l’erreur d’origine restant disponible dans `cause`.
  const findUserByIdentifier = (identifier) =>
    callDependency("UserRepository.findByIdentifier", () => users.findByIdentifier(identifier));
  const findUserById = (id) => callDependency("UserRepository.findById", () => users.findById(id));
  const verifyPassword = (password, hash) =>
    callDependency("PasswordProvider.verify", () => passwordProvider.verify(password, hash));
  const issueToken = (subject) => callDependency("TokenProvider.issue", () => tokenProvider.issue({ subject }));
  const verifyToken = (token) => callDependency("TokenProvider.verify", () => tokenProvider.verify(token));

  /**
   * @param {LoginCredentials} credentials
   * @returns {Promise<LoginResult>}
   */
  async function login(credentials) {
    const { identifier, password } = validateCredentials(credentials);

    const user = normalizeUserRecord(await findUserByIdentifier(identifier));

    if (user === null) {
      // Réduit les fuites de temps : vérifie aussi un faux hash pour que les
      // comptes inconnus coûtent autant qu’un compte existant.
      await verifyPassword(password, await getDummyHash());
      throw new InvalidCredentialsError(AUTH_FAILURE_REASONS.USER_NOT_FOUND);
    }

    // Vérifie volontairement le mot de passe avant le statut du compte :
    // un compte désactivé prend alors le même temps qu’un compte actif.
    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (passwordMatches !== true) {
      throw new InvalidCredentialsError(AUTH_FAILURE_REASONS.INVALID_PASSWORD);
    }
    if (user.isActive !== true) {
      throw new InvalidCredentialsError(AUTH_FAILURE_REASONS.ACCOUNT_DISABLED);
    }

    const issued = assertIssuedToken(await issueToken(user.id));
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

    const claims = await verifyToken(token);
    if (typeof claims?.subject !== "string" || claims.subject.length === 0) {
      throw new ContractViolationError(DEVELOPER_MESSAGES.tokenClaimsWithoutSubject);
    }

    // Vérifier l’utilisateur à chaque requête bloque immédiatement les
    // comptes supprimés ou désactivés, ce qu’un JWT seul ne peut pas faire.
    const user = normalizeUserRecord(await findUserById(claims.subject));
    if (user === null) {
      throw new InvalidTokenError({ reason: AUTH_FAILURE_REASONS.USER_NOT_FOUND });
    }
    if (user.id !== claims.subject) {
      throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryIdMismatch);
    }
    if (user.isActive !== true) {
      throw new InvalidTokenError({ reason: AUTH_FAILURE_REASONS.ACCOUNT_DISABLED });
    }

    return createAuthPrincipal(claims, user.id);
  }

  return Object.freeze({ login, verifyAccessToken });
}

/**
 * Vérifie la forme du jeton renvoyé par un TokenProvider (utile surtout pour
 * les providers personnalisés).
 *
 * @param {unknown} issued
 * @returns {import("./contracts/token-provider.js").IssuedToken}
 * @throws {ContractViolationError}
 */
function assertIssuedToken(issued) {
  const isValid =
    typeof issued?.token === "string" &&
    issued.token.length > 0 &&
    typeof issued.tokenId === "string" &&
    Number.isFinite(issued.issuedAt) &&
    Number.isFinite(issued.expiresAt);
  if (!isValid) {
    throw new ContractViolationError(DEVELOPER_MESSAGES.issuedTokenInvalid);
  }
  return issued;
}

/**
 * @param {unknown} credentials
 * @returns {LoginCredentials}
 * @throws {InvalidInputError}
 */
function validateCredentials(credentials) {
  if (credentials === null || typeof credentials !== "object") {
    throw new InvalidInputError(PUBLIC_MESSAGES.credentialsNotObject);
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
    throw new InvalidInputError(fieldRequired(field));
  }
  if (value.length > maxLength) {
    throw new InvalidInputError(fieldTooLong(field, maxLength));
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
    pending ??= callDependency("PasswordProvider.hash", () =>
      passwordProvider.hash(globalThis.crypto.randomUUID())
    ).catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

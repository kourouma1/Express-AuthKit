import { createAuthPrincipal } from "./contracts/auth-principal.js";
import { normalizeUserRecord, toUserIdString } from "./contracts/user-repository.js";
import {
  AUTH_FAILURE_REASONS,
  ConfigurationError,
  ContractViolationError,
  InvalidCredentialsError,
  InvalidInputError,
  InvalidPasswordHashError,
  InvalidRefreshTokenError,
  InvalidTokenError,
  TokenExpiredError,
  TokenMissingError,
  TooManyAttemptsError,
  attachUserId,
  callDependency
} from "./errors.js";
import { AUDIT_EVENTS, emitLibraryWarning } from "./audit.js";
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
 * @param {ReturnType<typeof import("./refresh-token-service.js").createRefreshTokenService>} [dependencies.refreshTokens]
 *   Service des jetons de rafraîchissement ; absent si la fonctionnalité n’est pas activée.
 * @param {ReturnType<typeof import("./attempt-limiter.js").createAttemptLimiter>} [dependencies.attempts]
 *   Limitation des tentatives de connexion ; absente si elle est désactivée.
 * @param {(type: string, details?: Record<string, unknown>) => void} [dependencies.audit]
 *   Émetteur d’événements d’audit.
 * @returns {AuthenticationService}
 */
export function createAuthenticationService({ users, passwordProvider, tokenProvider, refreshTokens, attempts, audit = () => {} }) {
  const getDummyHash = createDummyHashSource(passwordProvider);

  // Chaque appel à une dépendance injectée est enveloppé : une panne (base de
  // données indisponible, bug d’un provider) devient une DependencyFailureError
  // avec un code stable, l’erreur d’origine restant disponible dans `cause`.
  /** @param {string} identifier */
  const findUserByIdentifier = (identifier) =>
    callDependency("UserRepository.findByIdentifier", () => users.findByIdentifier(identifier));
  /** @param {string} id */
  const findUserById = (id) => callDependency("UserRepository.findById", () => users.findById(id));
  /** @param {string} password @param {string} hash */
  const verifyPassword = (password, hash) =>
    callDependency("PasswordProvider.verify", () => passwordProvider.verify(password, hash));
  /** @param {string} subject */
  const issueToken = (subject) => callDependency("TokenProvider.issue", () => tokenProvider.issue({ subject }));
  /** @param {string} token */
  const verifyToken = (token) => callDependency("TokenProvider.verify", () => tokenProvider.verify(token));

  /**
   * Connexion par identifiant et mot de passe.
   *
   * @param {LoginCredentials} credentials
   * @param {import("./contracts/authentication-service.js").LoginContext} [context] `clientKey` : identifiant
   *   du client (adresse IP), pour la limitation des tentatives par client.
   * @returns {Promise<LoginResult>}
   */
  async function login(credentials, context = {}) {
    const { identifier, password } = validateCredentials(credentials);
    const client = clientKeyFrom(context);

    // 1. La tentative est comptée (de façon atomique) avant tout calcul coûteux :
    //    des requêtes parallèles ne peuvent pas dépasser la limite.
    let reservation;
    if (attempts) {
      try {
        reservation = await attempts.reserve(identifier, client);
      } catch (error) {
        if (error instanceof TooManyAttemptsError) {
          audit(AUDIT_EVENTS.LOGIN_BLOCKED, { identifier, client, scope: /** @type {any} */ (error).scope, retryAfterSeconds: error.retryAfterSeconds });
        }
        throw error;
      }
    }

    // 2. Vérification des identifiants.
    let user;
    try {
      user = await checkCredentials(identifier, password);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        audit(AUDIT_EVENTS.LOGIN_FAILED, { identifier, client, reason: /** @type {any} */ (error).reason, userId: /** @type {any} */ (error).userId });
        if (reservation?.locksOnFailure) {
          audit(AUDIT_EVENTS.ACCOUNT_LOCKED, { identifier, client, retryAfterSeconds: Math.ceil(reservation.retryAfterSeconds) });
        }
      }
      throw error;
    }

    // 3. Succès : compteur remis à zéro, hash modernisé si besoin, session ouverte.
    if (attempts) {
      await attempts.recordSuccess(identifier);
    }
    await upgradePasswordHash(user, password);
    const session = await createSession(user);
    audit(AUDIT_EVENTS.LOGIN_SUCCEEDED, { userId: user.id, identifier, client });
    return session;
  }

  /**
   * Recalcule le hash d’un mot de passe dont les paramètres sont dépassés
   * (coûts Argon2id relevés, ancien algorithme accepté par un provider de
   * migration…). Nécessite les méthodes facultatives `PasswordProvider.needsRehash()`
   * et `UserRepository.updatePasswordHash()`. Un échec ne bloque pas la connexion :
   * il est signalé par l’audit et par un avertissement Node.js.
   *
   * @param {import("./contracts/user-repository.js").NormalizedUserRecord} user
   * @param {string} password
   */
  async function upgradePasswordHash(user, password) {
    if (typeof passwordProvider.needsRehash !== "function" || typeof users.updatePasswordHash !== "function") {
      return;
    }
    try {
      const outdated = await callDependency("PasswordProvider.needsRehash", () => passwordProvider.needsRehash?.(user.passwordHash));
      if (outdated !== true) {
        return;
      }
      const newHash = await callDependency("PasswordProvider.hash", () => passwordProvider.hash(password));
      await callDependency("UserRepository.updatePasswordHash", () => users.updatePasswordHash?.(user.id, newHash));
      audit(AUDIT_EVENTS.PASSWORD_REHASHED, { userId: user.id });
    } catch (error) {
      // Seuls des champs produits par la bibliothèque sont transmis : l’erreur
      // d’origine (requête SQL, nouveau hash…) reste dans l’avertissement.
      const { code, dependency } = /** @type {{ code?: string, dependency?: string }} */ (error ?? {});
      audit(AUDIT_EVENTS.PASSWORD_REHASH_FAILED, { userId: user.id, error: { code, dependency } });
      emitLibraryWarning(DEVELOPER_MESSAGES.passwordRehashFailed, "EXPRESS_AUTHKIT_REHASH", /** @type {any} */ (error)?.cause ?? error);
    }
  }

  /**
   * @param {string} identifier
   * @param {string} password
   * @returns {Promise<import("./contracts/user-repository.js").NormalizedUserRecord>}
   */
  async function checkCredentials(identifier, password) {
    const user = normalizeUserRecord(await findUserByIdentifier(identifier));

    if (user === null) {
      // Réduit les fuites de temps : vérifie aussi un faux hash pour que les
      // comptes inconnus coûtent autant qu’un compte existant.
      await verifyPassword(password, await getDummyHash());
      throw new InvalidCredentialsError(AUTH_FAILURE_REASONS.USER_NOT_FOUND);
    }

    // Vérifie volontairement le mot de passe avant le statut du compte :
    // un compte désactivé prend alors le même temps qu’un compte actif.
    let passwordMatches;
    try {
      passwordMatches = await verifyPassword(password, user.passwordHash);
    } catch (error) {
      if (!(error instanceof InvalidPasswordHashError)) {
        throw error;
      }
      // Un hash illisible ne doit pas produire une réponse différente (500) qui
      // révélerait l’existence du compte : c’est un échec ordinaire pour le
      // client, compté par la limitation, et signalé au développeur.
      emitLibraryWarning(DEVELOPER_MESSAGES.passwordHashUnreadable, "EXPRESS_AUTHKIT_PASSWORD_HASH");
      throw attachUserId(new InvalidCredentialsError(AUTH_FAILURE_REASONS.INVALID_PASSWORD_HASH, { cause: error }), user.id);
    }
    if (passwordMatches !== true) {
      throw attachUserId(new InvalidCredentialsError(AUTH_FAILURE_REASONS.INVALID_PASSWORD), user.id);
    }
    if (user.isActive !== true) {
      throw attachUserId(new InvalidCredentialsError(AUTH_FAILURE_REASONS.ACCOUNT_DISABLED), user.id);
    }
    return user;
  }

  /**
   * Échange un jeton de rafraîchissement contre une nouvelle paire de jetons.
   * L’ancien jeton devient inutilisable (rotation).
   *
   * @param {string} refreshToken
   * @returns {Promise<LoginResult>}
   */
  async function refresh(refreshToken) {
    const service = requireRefreshTokens();
    try {
      const session = await refreshSession(service, refreshToken);
      audit(AUDIT_EVENTS.REFRESH_SUCCEEDED, { userId: session.principal.userId });
      return session;
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        const { reason, userId } = /** @type {any} */ (error);
        audit(reason === AUTH_FAILURE_REASONS.REFRESH_TOKEN_REUSED ? AUDIT_EVENTS.REFRESH_REUSE_DETECTED : AUDIT_EVENTS.REFRESH_REJECTED, { userId, reason });
      }
      throw error;
    }
  }

  /**
   * @param {NonNullable<typeof refreshTokens>} service
   * @param {string} refreshToken
   * @returns {Promise<LoginResult>}
   */
  async function refreshSession(service, refreshToken) {
    const consumed = await service.consume(refreshToken);

    // Le compte a pu être supprimé ou désactivé depuis la connexion.
    const user = normalizeUserRecord(await findUserById(consumed.userId));
    if (user === null || user.isActive !== true) {
      await service.revokeFamily(consumed.familyId);
      throw attachUserId(
        new InvalidRefreshTokenError(user === null ? AUTH_FAILURE_REASONS.USER_NOT_FOUND : AUTH_FAILURE_REASONS.ACCOUNT_DISABLED),
        consumed.userId
      );
    }
    if (user.id !== consumed.userId) {
      await service.revokeFamily(consumed.familyId);
      throw new ContractViolationError(DEVELOPER_MESSAGES.repositoryIdMismatch);
    }

    const session = await createSession(user, consumed.familyId);
    // La session a pu être révoquée (déconnexion, revokeAllSessions(), vol
    // détecté) pendant la rotation, après la lecture de l’ancien jeton mais
    // avant l’enregistrement du nouveau : on le vérifie après coup.
    await service.assertRotationNotRevoked(consumed);
    return session;
  }

  /**
   * Déconnecte la session liée à ce jeton de rafraîchissement. Réussit même si
   * le jeton est déjà révoqué ou expiré.
   *
   * @param {string} refreshToken
   * @returns {Promise<void>}
   */
  async function logout(refreshToken) {
    const userId = await requireRefreshTokens().revokeSessionOf(refreshToken);
    audit(AUDIT_EVENTS.LOGOUT, { userId });
  }

  /**
   * Déconnecte toutes les sessions d’un utilisateur (par exemple après un
   * changement de mot de passe).
   *
   * @param {string | number | bigint | { toHexString(): string }} userId
   * @returns {Promise<void>}
   */
  async function revokeAllSessions(userId) {
    const service = requireRefreshTokens();
    const id = toUserIdString(userId);
    if (id === null) {
      throw new InvalidInputError(PUBLIC_MESSAGES.userIdInvalid);
    }
    await service.revokeUser(id);
    audit(AUDIT_EVENTS.SESSIONS_REVOKED, { userId: id });
  }

  /**
   * Émet un jeton d’accès et, si la fonctionnalité est activée, un jeton de
   * rafraîchissement (dans la famille donnée, ou une nouvelle).
   *
   * @param {import("./contracts/user-repository.js").NormalizedUserRecord} user
   * @param {string} [familyId]
   * @returns {Promise<LoginResult>}
   */
  async function createSession(user, familyId) {
    const issued = assertIssuedToken(await issueToken(user.id));
    const result = {
      accessToken: issued.token,
      tokenType: /** @type {const} */ ("Bearer"),
      expiresIn: issued.expiresAt - issued.issuedAt,
      principal: createAuthPrincipal(issued, user)
    };
    if (refreshTokens === undefined) {
      return result;
    }
    const refreshed = await refreshTokens.issue(user.id, familyId);
    return { ...result, refreshToken: refreshed.token, refreshExpiresIn: refreshed.expiresIn };
  }

  function requireRefreshTokens() {
    if (refreshTokens === undefined) {
      throw new ConfigurationError(DEVELOPER_MESSAGES.refreshTokensDisabled);
    }
    return refreshTokens;
  }

  /**
   * @param {string} token
   * @param {import("./contracts/authentication-service.js").LoginContext} [context] `clientKey` :
   *   client à l’origine de la requête, pour l’audit.
   * @returns {Promise<AuthPrincipal>}
   */
  async function verifyAccessToken(token, context = {}) {
    try {
      return await checkAccessToken(token);
    } catch (error) {
      // Un jeton absent n'est pas une anomalie (route publique, premier appel) :
      // seuls les jetons présents mais refusés sont signalés.
      if (error instanceof InvalidTokenError || error instanceof TokenExpiredError) {
        audit(AUDIT_EVENTS.TOKEN_REJECTED, { reason: /** @type {any} */ (error).reason ?? error.code, client: clientKeyFrom(context) });
      }
      throw error;
    }
  }

  /**
   * @param {string} token
   * @returns {Promise<AuthPrincipal>}
   */
  async function checkAccessToken(token) {
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

    return createAuthPrincipal(claims, user);
  }

  return Object.freeze({ login, refresh, logout, revokeAllSessions, verifyAccessToken });
}

/**
 * @param {import("./contracts/authentication-service.js").LoginContext | undefined} context
 * @returns {string | undefined}
 */
function clientKeyFrom(context) {
  const clientKey = context?.clientKey;
  return typeof clientKey === "string" && clientKey.length > 0 ? clientKey : undefined;
}

/**
 * Vérifie la forme du jeton renvoyé par un TokenProvider (utile surtout pour
 * les providers personnalisés).
 *
 * @param {unknown} value
 * @returns {import("./contracts/token-provider.js").IssuedToken}
 * @throws {ContractViolationError}
 */
function assertIssuedToken(value) {
  const issued = /** @type {Partial<import("./contracts/token-provider.js").IssuedToken> | null | undefined} */ (value);
  const isValid =
    typeof issued?.token === "string" &&
    issued.token.length > 0 &&
    typeof issued.tokenId === "string" &&
    Number.isFinite(issued.issuedAt) &&
    Number.isFinite(issued.expiresAt);
  if (!isValid) {
    throw new ContractViolationError(DEVELOPER_MESSAGES.issuedTokenInvalid);
  }
  return /** @type {import("./contracts/token-provider.js").IssuedToken} */ (issued);
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

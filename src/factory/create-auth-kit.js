import { validateAuthKitOptions } from "../config/auth-kit-options.js";
import { resolveRefreshTokenOptions } from "../config/refresh-token-options.js";
import { createAuthenticationService } from "../core/authentication-service.js";
import { createRefreshTokenService } from "../core/refresh-token-service.js";
import { callDependency } from "../core/errors.js";
import { assertPasswordProvider } from "../core/contracts/password-provider.js";
import { assertTokenProvider } from "../core/contracts/token-provider.js";
import { assertUserRepository } from "../core/contracts/user-repository.js";
import { createArgon2PasswordProvider } from "../providers/argon2-password-provider.js";
import { createJwtTokenProvider } from "../providers/jwt-token-provider.js";

/**
 * Fonctions liées aux mots de passe, exposées dans `auth.password`.
 *
 * @typedef {Readonly<{
 *   hash: (password: string) => Promise<string>,
 *   verify: (password: string, hash: string) => Promise<boolean>
 * }>} PasswordApi
 */

/**
 * Moteur d’authentification renvoyé par {@link createAuthKit}.
 *
 * @typedef {Readonly<{
 *   login: (credentials: import("../core/contracts/authentication-service.js").LoginCredentials) => Promise<import("../core/contracts/authentication-service.js").LoginResult>,
 *   refresh: (refreshToken: string) => Promise<import("../core/contracts/authentication-service.js").LoginResult>,
 *   logout: (refreshToken: string) => Promise<void>,
 *   revokeAllSessions: (userId: import("../core/contracts/authentication-service.js").UserIdInput) => Promise<void>,
 *   verifyAccessToken: (token: string) => Promise<import("../core/contracts/auth-principal.js").AuthPrincipal>,
 *   password: PasswordApi
 * }>} AuthKit
 */

/**
 * Crée et configure un moteur d’authentification.
 *
 * Toutes les options et dépendances injectées sont validées ici. Une mauvaise
 * configuration arrête donc l’application au démarrage, et non à la première
 * requête. L’objet renvoyé ne conserve aucun état par utilisateur et peut être
 * partagé dans tout le processus.
 *
 * @example
 * const auth = createAuthKit({
 *   users: userRepository,
 *   jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" }
 * });
 *
 * @param {import("../config/auth-kit-options.js").AuthKitOptions} options
 * @returns {AuthKit}
 * @throws {import("../core/errors.js").ConfigurationError} Si les options manquent ou ne sont pas sûres.
 * @throws {import("../core/errors.js").ContractViolationError} Si une dépendance injectée ne respecte pas son contrat.
 */
export function createAuthKit(options) {
  const { users, jwt, password, refreshTokens, providers = {} } = validateAuthKitOptions(options);

  assertUserRepository(users);

  const passwordProvider = providers.password ?? createArgon2PasswordProvider(password);
  assertPasswordProvider(passwordProvider);

  // validateAuthKitOptions() garantit que `jwt` est présent quand aucun provider de token n’est fourni.
  const tokenProvider =
    providers.token ?? createJwtTokenProvider(/** @type {import("../config/jwt-options.js").JwtOptions} */ (jwt));
  assertTokenProvider(tokenProvider);

  const refreshTokenService =
    refreshTokens === undefined ? undefined : createRefreshTokenService(resolveRefreshTokenOptions(refreshTokens));

  const service = createAuthenticationService({
    users,
    passwordProvider,
    tokenProvider,
    refreshTokens: refreshTokenService
  });

  return Object.freeze({
    login: service.login,
    refresh: service.refresh,
    logout: service.logout,
    revokeAllSessions: service.revokeAllSessions,
    verifyAccessToken: service.verifyAccessToken,
    password: Object.freeze({
      /** @param {string} plainPassword */
      hash: (plainPassword) => callDependency("PasswordProvider.hash", () => passwordProvider.hash(plainPassword)),
      /** @param {string} plainPassword @param {string} passwordHash */
      verify: (plainPassword, passwordHash) =>
        callDependency("PasswordProvider.verify", () => passwordProvider.verify(plainPassword, passwordHash))
    })
  });
}

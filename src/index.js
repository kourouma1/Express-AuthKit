/**
 * Express AuthKit — point d’entrée indépendant du framework.
 *
 * API publique. Les modules non réexportés ici sont internes et peuvent
 * évoluer sans préavis.
 *
 * @module express-authkit
 */

export { createAuthKit } from "./factory/create-auth-kit.js";

export { createArgon2PasswordProvider } from "./providers/argon2-password-provider.js";
export { createJwtTokenProvider } from "./providers/jwt-token-provider.js";

export { assertUserRepository } from "./core/contracts/user-repository.js";
export { assertPasswordProvider } from "./core/contracts/password-provider.js";
export { assertTokenProvider } from "./core/contracts/token-provider.js";

export {
  AUTH_ERROR_CODES,
  AUTH_FAILURE_REASONS,
  AuthKitError,
  ConfigurationError,
  ContractViolationError,
  InvalidCredentialsError,
  InvalidInputError,
  InvalidPasswordHashError,
  InvalidTokenError,
  TokenExpiredError,
  TokenMissingError,
  isAuthKitError
} from "./core/errors.js";

/**
 * @typedef {import("./factory/create-auth-kit.js").AuthKit} AuthKit
 * @typedef {import("./config/auth-kit-options.js").AuthKitOptions} AuthKitOptions
 * @typedef {import("./config/jwt-options.js").JwtOptions} JwtOptions
 * @typedef {import("./config/password-options.js").PasswordOptions} PasswordOptions
 * @typedef {import("./core/contracts/user-repository.js").UserRepository} UserRepository
 * @typedef {import("./core/contracts/user-repository.js").AuthUserRecord} AuthUserRecord
 * @typedef {import("./core/contracts/password-provider.js").PasswordProvider} PasswordProvider
 * @typedef {import("./core/contracts/token-provider.js").TokenProvider} TokenProvider
 * @typedef {import("./core/contracts/token-provider.js").IssuedToken} IssuedToken
 * @typedef {import("./core/contracts/token-provider.js").VerifiedTokenClaims} VerifiedTokenClaims
 * @typedef {import("./core/contracts/authentication-service.js").AuthenticationService} AuthenticationService
 * @typedef {import("./core/contracts/authentication-service.js").LoginCredentials} LoginCredentials
 * @typedef {import("./core/contracts/authentication-service.js").LoginResult} LoginResult
 * @typedef {import("./core/contracts/auth-principal.js").AuthPrincipal} AuthPrincipal
 */

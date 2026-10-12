/**
 * Express AuthKit — point d’entrée indépendant du framework.
 *
 * API publique. Les modules non réexportés ici sont internes et peuvent
 * évoluer sans préavis.
 *
 * @module @express-authkit/core
 */

export { createAuthKit } from "./factory/create-auth-kit.js";
export { isAuthorized } from "./core/authorization.js";

export { createArgon2PasswordProvider } from "./providers/argon2-password-provider.js";
export { createJwtTokenProvider } from "./providers/jwt-token-provider.js";
export { createInMemoryRefreshTokenStore } from "./providers/in-memory-refresh-token-store.js";
export { createInMemoryAttemptStore } from "./providers/in-memory-attempt-store.js";
export { isPasswordCompromised } from "./providers/pwned-passwords.js";
export { AUDIT_EVENTS } from "./core/audit.js";

export { assertUserRepository } from "./core/contracts/user-repository.js";
export { assertPasswordProvider } from "./core/contracts/password-provider.js";
export { assertTokenProvider } from "./core/contracts/token-provider.js";
export { assertRefreshTokenStore } from "./core/contracts/refresh-token-store.js";
export { assertAttemptStore } from "./core/contracts/attempt-store.js";

export {
  AUTH_ERROR_CODES,
  AUTH_FAILURE_REASONS,
  AccessDeniedError,
  AuthKitError,
  ConfigurationError,
  ContractViolationError,
  DependencyFailureError,
  InvalidCredentialsError,
  InvalidInputError,
  InvalidPasswordHashError,
  InvalidRefreshTokenError,
  InvalidTokenError,
  TokenExpiredError,
  TokenMissingError,
  TooManyAttemptsError,
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
 * @typedef {import("./core/contracts/authentication-service.js").UserIdInput} UserIdInput
 * @typedef {import("./core/authorization.js").AuthorizationRequirement} AuthorizationRequirement
 * @typedef {import("./core/contracts/authentication-service.js").LoginContext} LoginContext
 * @typedef {import("./config/login-attempt-options.js").LoginAttemptOptions} LoginAttemptOptions
 * @typedef {import("./core/contracts/attempt-store.js").AttemptStore} AttemptStore
 * @typedef {import("./core/contracts/attempt-store.js").AttemptCounter} AttemptCounter
 * @typedef {import("./core/audit.js").AuditEvent} AuditEvent
 * @typedef {import("./config/refresh-token-options.js").RefreshTokenOptions} RefreshTokenOptions
 * @typedef {import("./core/contracts/refresh-token-store.js").RefreshTokenStore} RefreshTokenStore
 * @typedef {import("./core/contracts/refresh-token-store.js").RefreshTokenRecord} RefreshTokenRecord
 * @typedef {import("./core/contracts/refresh-token-store.js").ConsumedRefreshToken} ConsumedRefreshToken
 */

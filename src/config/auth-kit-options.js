import { ConfigurationError } from "../core/errors.js";
import { DEVELOPER_MESSAGES } from "../core/messages.js";
import { assertKnownKeys, assertPlainObject } from "./assertions.js";

/**
 * Fournisseurs qui remplacent les implémentations intégrées.
 *
 * @typedef {object} ProviderOverrides
 * @property {import("../core/contracts/password-provider.js").PasswordProvider} [password]
 *   Remplace le fournisseur Argon2id. Les options `password` doivent alors être absentes.
 * @property {import("../core/contracts/token-provider.js").TokenProvider} [token]
 *   Remplace le fournisseur JWT. Les options `jwt` doivent alors être absentes.
 */

/**
 * Options acceptées par `createAuthKit()`.
 *
 * @typedef {object} AuthKitOptions
 * @property {import("../core/contracts/user-repository.js").UserRepository} users Dépôt d’utilisateurs de l’application.
 * @property {import("./jwt-options.js").JwtOptions} [jwt] Obligatoire sans `providers.token`.
 * @property {import("./password-options.js").PasswordOptions} [password] Paramètres de coût Argon2id.
 * @property {ProviderOverrides} [providers] Implémentations personnalisées des fournisseurs.
 */

const ALLOWED_KEYS = Object.freeze(["users", "jwt", "password", "providers"]);
const ALLOWED_PROVIDER_KEYS = Object.freeze(["password", "token"]);

/**
 * Valide la structure principale des options. Les valeurs imbriquées sont
 * validées par leurs résolveurs et leurs vérifications de contrat dédiés.
 *
 * @param {unknown} options
 * @returns {AuthKitOptions}
 * @throws {ConfigurationError}
 */
export function validateAuthKitOptions(options) {
  assertPlainObject(options, "createAuthKit(options)");
  assertKnownKeys(options, ALLOWED_KEYS, "createAuthKit(options)");

  if (options.users === undefined || options.users === null) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.usersRequired);
  }

  const providers = options.providers ?? {};
  assertPlainObject(providers, "providers");
  assertKnownKeys(providers, ALLOWED_PROVIDER_KEYS, "providers");

  if (providers.token !== undefined && options.jwt !== undefined) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.jwtOrTokenProvider);
  }
  if (providers.token === undefined && options.jwt === undefined) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.jwtRequired);
  }
  if (providers.password !== undefined && options.password !== undefined) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.passwordOrPasswordProvider);
  }

  return /** @type {AuthKitOptions} */ (options);
}

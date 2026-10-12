import { argon2id, hash as argon2Hash, verify as argon2Verify } from "argon2";

import { resolvePasswordOptions } from "../config/password-options.js";
import { InvalidInputError, InvalidPasswordHashError } from "../core/errors.js";
import { MAX_PASSWORD_LENGTH } from "../core/input-limits.js";
import { fieldRequired, fieldTooLong } from "../core/messages.js";

/** Seuls les hash Argon2id sont acceptés : Argon2i et Argon2d ne sont pas recommandés pour les mots de passe. */
const ARGON2ID_PREFIX = "$argon2id$";

/**
 * Crée un {@link import("../core/contracts/password-provider.js").PasswordProvider}
 * basé sur le paquet `argon2` (implémentation C de référence, variante Argon2id).
 *
 * La bibliothèque génère le sel avec un générateur aléatoire sécurisé et le
 * conserve avec les paramètres dans le hash. Modifier les coûts plus tard ne
 * rend donc pas les hash existants invalides.
 *
 * @param {import("../config/password-options.js").PasswordOptions} [options]
 * @returns {import("../core/contracts/password-provider.js").PasswordProvider}
 * @throws {import("../core/errors.js").ConfigurationError}
 */
export function createArgon2PasswordProvider(options) {
  const parameters = resolvePasswordOptions(options);

  /**
   * @param {string} password
   * @returns {Promise<string>}
   */
  async function hash(password) {
    assertPassword(password);
    return argon2Hash(password, { type: argon2id, ...parameters });
  }

  /**
   * @param {string} password
   * @param {string} passwordHash
   * @returns {Promise<boolean>}
   */
  async function verify(password, passwordHash) {
    assertPassword(password);
    if (typeof passwordHash !== "string" || !passwordHash.startsWith(ARGON2ID_PREFIX)) {
      throw new InvalidPasswordHashError();
    }
    try {
      // argon2.verify() recalcule le hash avec le sel et les paramètres
      // stockés, puis compare les résultats en temps constant.
      return await argon2Verify(passwordHash, password);
    } catch (error) {
      throw new InvalidPasswordHashError({ cause: error });
    }
  }

  return Object.freeze({ hash, verify });
}

/**
 * @param {unknown} password
 * @returns {asserts password is string}
 */
function assertPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new InvalidInputError(fieldRequired("password"));
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new InvalidInputError(fieldTooLong("password", MAX_PASSWORD_LENGTH));
  }
}

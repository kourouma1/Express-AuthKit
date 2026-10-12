import { ConfigurationError } from "../core/errors.js";

/**
 * Petites fonctions de vérification partagées par les validateurs de configuration.
 *
 * @module config/assertions
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {asserts value is Record<string, unknown>}
 */
export function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new ConfigurationError(`\`${name}\` must be a plain object.`);
  }
}

/**
 * Refuse les clés inconnues afin qu’une faute de frappe (par exemple
 * `expiresIn` au lieu de `expiresInSeconds`) ne passe pas inaperçue.
 *
 * @param {Record<string, unknown>} object
 * @param {readonly string[]} allowedKeys
 * @param {string} name
 */
export function assertKnownKeys(object, allowedKeys, name) {
  const unknown = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unknown option(s) in \`${name}\`: ${unknown.join(", ")}. Allowed: ${allowedKeys.join(", ")}.`
    );
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} maxLength
 * @returns {asserts value is string}
 */
export function assertNonEmptyString(value, name, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigurationError(`\`${name}\` must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new ConfigurationError(`\`${name}\` must not exceed ${maxLength} characters.`);
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @returns {asserts value is number}
 */
export function assertIntegerInRange(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`\`${name}\` must be an integer between ${min} and ${max}.`);
  }
}

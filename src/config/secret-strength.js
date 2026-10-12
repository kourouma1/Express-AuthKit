import { ConfigurationError } from "../core/errors.js";
import { DEVELOPER_MESSAGES, secretTooShort } from "../core/messages.js";

/**
 * Détection heuristique des secrets JWT manifestement faibles.
 *
 * Ce contrôle ne peut pas prouver qu’un secret est aléatoire : il rejette
 * seulement les erreurs fréquentes (valeurs d’exemple, courtes ou répétées).
 * Générez toujours les secrets avec un générateur aléatoire sûr, par exemple
 * `npx express-authkit secret`.
 *
 * @module config/secret-strength
 */

/** Fragments qui signalent une valeur d’exemple copiée d’un tutoriel ou d’un `.env.example`. */
const PLACEHOLDER_FRAGMENTS = Object.freeze([
  "changeme",
  "change-me",
  "change_me",
  "replace-me",
  "replace_me",
  "your-secret",
  "your_secret",
  "yoursecret",
  "mysecret",
  "my-secret",
  "my_secret",
  "supersecret",
  "super-secret",
  "super_secret",
  "jwt-secret",
  "jwt_secret",
  "secretkey",
  "secret-key",
  "secret_key",
  "placeholder",
  "example",
  "password",
  "xxxxxxxx",
  "12345678"
]);

const MIN_DISTINCT_CHARACTERS = 10;
const MAX_REPEATED_UNIT_LENGTH = 16;

/**
 * @param {unknown} secret
 * @param {number} minBytes
 * @returns {Uint8Array} Secret encodé en octets, prêt pour le fournisseur JWT.
 * @throws {ConfigurationError}
 */
export function assertStrongSecret(secret, minBytes) {
  if (secret === undefined || secret === null || secret === "") {
    throw new ConfigurationError(DEVELOPER_MESSAGES.secretRequired);
  }

  if (typeof secret === "string") {
    // Un espace ou un « \r » final (fichier .env Windows) passe inaperçu et donne
    // des clés différentes d’une instance à l’autre : on le refuse explicitement.
    if (secret !== secret.trim()) {
      throw new ConfigurationError(DEVELOPER_MESSAGES.secretWhitespace);
    }
    assertStrongStringSecret(secret);
    return checkLength(new TextEncoder().encode(secret), minBytes);
  }

  if (secret instanceof Uint8Array) {
    // Les mêmes contrôles s’appliquent aux octets (Buffer.from("changeme…")).
    assertStrongStringSecret(Buffer.from(secret).toString("latin1"));
    // Copie le tampon pour empêcher une modification ultérieure de changer la clé.
    return checkLength(Uint8Array.from(secret), minBytes);
  }

  throw new ConfigurationError(DEVELOPER_MESSAGES.secretWrongType);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} minBytes
 * @returns {Uint8Array}
 */
function checkLength(bytes, minBytes) {
  if (bytes.length < minBytes) {
    throw new ConfigurationError(secretTooShort(minBytes));
  }
  return bytes;
}

/**
 * @param {string} secret
 */
function assertStrongStringSecret(secret) {
  const lowered = secret.toLowerCase();
  if (PLACEHOLDER_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.secretPlaceholder);
  }
  if (new Set(secret).size < MIN_DISTINCT_CHARACTERS || isRepeatedPattern(secret)) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.secretRepetitive);
  }
}

/**
 * Détecte les valeurs telles que « abcdefghij » répétées de nombreuses fois.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isRepeatedPattern(value) {
  for (let size = 1; size <= MAX_REPEATED_UNIT_LENGTH && size < value.length; size += 1) {
    const unit = value.slice(0, size);
    if (unit.repeat(Math.ceil(value.length / size)).slice(0, value.length) === value) {
      return true;
    }
  }
  return false;
}

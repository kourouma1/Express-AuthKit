import { ConfigurationError } from "../core/errors.js";

/**
 * Détection heuristique des secrets JWT manifestement faibles.
 *
 * Ce contrôle ne peut pas prouver qu’un secret est aléatoire : il rejette
 * seulement les erreurs fréquentes (valeurs d’exemple, courtes ou répétées).
 * Générez toujours les secrets avec un générateur aléatoire sûr, par exemple :
 * `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
 *
 * @module config/secret-strength
 */

const GENERATE_HINT =
  "Generate one with: node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\"";

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
    throw new ConfigurationError(`\`jwt.secret\` is required. ${GENERATE_HINT}`);
  }

  if (typeof secret === "string") {
    assertStrongStringSecret(secret);
    return checkLength(new TextEncoder().encode(secret), minBytes);
  }

  if (secret instanceof Uint8Array) {
    if (new Set(secret).size < MIN_DISTINCT_CHARACTERS) {
      throw new ConfigurationError(`\`jwt.secret\` is too repetitive to be random. ${GENERATE_HINT}`);
    }
    // Copie le tampon pour empêcher une modification ultérieure de changer la clé.
    return checkLength(Uint8Array.from(secret), minBytes);
  }

  throw new ConfigurationError("`jwt.secret` must be a string or a Uint8Array.");
}

/**
 * @param {Uint8Array} bytes
 * @param {number} minBytes
 * @returns {Uint8Array}
 */
function checkLength(bytes, minBytes) {
  if (bytes.length < minBytes) {
    throw new ConfigurationError(
      `\`jwt.secret\` must be at least ${minBytes} bytes long for the selected algorithm. ${GENERATE_HINT}`
    );
  }
  return bytes;
}

/**
 * @param {string} secret
 */
function assertStrongStringSecret(secret) {
  const lowered = secret.toLowerCase();
  if (PLACEHOLDER_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    throw new ConfigurationError(`\`jwt.secret\` looks like a placeholder value. ${GENERATE_HINT}`);
  }
  if (new Set(secret).size < MIN_DISTINCT_CHARACTERS || isRepeatedPattern(secret)) {
    throw new ConfigurationError(`\`jwt.secret\` is too repetitive to be random. ${GENERATE_HINT}`);
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

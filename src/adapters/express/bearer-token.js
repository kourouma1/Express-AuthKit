import { InvalidTokenError, TokenMissingError } from "../../core/errors.js";
import { MAX_TOKEN_LENGTH } from "../../core/input-limits.js";

/** RFC 6750 §2.1 : `Bearer` suivi d’un jeton base64 ; le schéma ne distingue pas la casse. */
const BEARER_PATTERN = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;
const BEARER_SCHEME_PATTERN = /^Bearer(?: |$)/i;

/**
 * Extrait le jeton d’accès d’un en-tête `Authorization`.
 *
 * Un en-tête utilisant un autre schéma (par exemple `Basic`) est traité comme
 * une absence de jeton ; une valeur `Bearer` mal formée est invalide.
 *
 * @param {string | undefined} headerValue
 * @returns {string}
 * @throws {TokenMissingError | InvalidTokenError}
 */
export function extractBearerToken(headerValue) {
  if (typeof headerValue !== "string" || headerValue.trim() === "") {
    throw new TokenMissingError();
  }
  // La longueur de l’en-tête est limitée avant toute expression régulière.
  if (headerValue.length > MAX_TOKEN_LENGTH + "Bearer ".length) {
    throw new InvalidTokenError();
  }
  if (!BEARER_SCHEME_PATTERN.test(headerValue)) {
    throw new TokenMissingError();
  }

  const match = BEARER_PATTERN.exec(headerValue);
  if (match === null) {
    throw new InvalidTokenError();
  }
  return match[1];
}

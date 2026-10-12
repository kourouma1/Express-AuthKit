import { AUTH_ERROR_CODES, InvalidInputError, isAuthKitError } from "../../core/errors.js";
import { PUBLIC_MESSAGES } from "../../core/messages.js";

/**
 * Statuts HTTP pour les erreurs causées par le client. Toute autre erreur
 * (configuration, contrat, hash illisible, base de données…) est un problème
 * serveur et est transmise à la chaîne d’erreurs Express.
 *
 * @type {Readonly<Record<string, number>>}
 */
const CLIENT_ERROR_STATUSES = Object.freeze({
  [AUTH_ERROR_CODES.INVALID_INPUT]: 400,
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [AUTH_ERROR_CODES.TOKEN_MISSING]: 401,
  [AUTH_ERROR_CODES.TOKEN_INVALID]: 401,
  [AUTH_ERROR_CODES.TOKEN_EXPIRED]: 401,
  [AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID]: 401
});

/** Code d’erreur RFC 6750 §3.1 pour les jetons Bearer rejetés. */
/** @type {ReadonlySet<string>} */
const INVALID_TOKEN_CODES = new Set([AUTH_ERROR_CODES.TOKEN_INVALID, AUTH_ERROR_CODES.TOKEN_EXPIRED]);

/**
 * @param {unknown} error
 * @returns {number | undefined} Statut à envoyer, ou `undefined` si ce n’est pas une erreur client.
 */
export function getClientErrorStatus(error) {
  return isAuthKitError(error) ? CLIENT_ERROR_STATUSES[error.code] : undefined;
}

/**
 * Comme {@link getClientErrorStatus}, mais reconnaît aussi les erreurs du
 * parseur JSON d’Express (`express.json()`) : un JSON mal formé ou trop
 * volumineux reçoit une réponse JSON propre au lieu de la page d’erreur HTML
 * d’Express, qui peut afficher la pile d’appels en développement.
 *
 * @param {unknown} error
 * @returns {{ error: import("../../core/errors.js").AuthKitError, status: number } | undefined}
 */
export function resolveClientError(error) {
  const status = getClientErrorStatus(error);
  if (status !== undefined) {
    return { error: /** @type {import("../../core/errors.js").AuthKitError} */ (error), status };
  }
  const bodyParserErrorType =
    error !== null && typeof error === "object" ? /** @type {{ type?: unknown }} */ (error).type : undefined;
  if (bodyParserErrorType === "entity.parse.failed") {
    return { error: new InvalidInputError(PUBLIC_MESSAGES.malformedJsonBody), status: 400 };
  }
  if (bodyParserErrorType === "entity.too.large") {
    return { error: new InvalidInputError(PUBLIC_MESSAGES.payloadTooLarge), status: 413 };
  }
  return undefined;
}

/**
 * Envoie une erreur d’authentification client au format JSON.
 *
 * Seuls le `code` stable et le `message` public sont envoyés : jamais la pile,
 * la cause ou la raison interne de l’échec.
 *
 * @param {import("express").Response} res
 * @param {import("../../core/errors.js").AuthKitError} error
 * @param {number} status
 * @param {string} realm
 */
export function sendClientError(res, error, status, realm) {
  if (status === 401) {
    res.set("WWW-Authenticate", buildChallenge(error.code, realm));
  }
  res.set("Cache-Control", "no-store");
  res.status(status).json({ error: { code: error.code, message: error.message } });
}

/**
 * @param {string} code
 * @param {string} realm
 * @returns {string}
 */
function buildChallenge(code, realm) {
  const challenge = `Bearer realm="${realm}"`;
  return INVALID_TOKEN_CODES.has(code) ? `${challenge}, error="invalid_token"` : challenge;
}

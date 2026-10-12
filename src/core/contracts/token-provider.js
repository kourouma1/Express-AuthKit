import { assertImplements } from "./assert-contract.js";

/**
 * Résultat de l’émission d’un jeton d’accès.
 *
 * @typedef {object} IssuedToken
 * @property {string} token Jeton sérialisé.
 * @property {string} tokenId Identifiant unique du jeton (`jti`).
 * @property {number} issuedAt Date d’émission, en secondes depuis l’époque Unix.
 * @property {number} expiresAt Date d’expiration, en secondes depuis l’époque Unix.
 */

/**
 * Revendications extraites d’un jeton d’accès vérifié.
 *
 * @typedef {object} VerifiedTokenClaims
 * @property {string} subject Identifiant utilisateur (`sub`).
 * @property {string} tokenId Identifiant du jeton (`jti`).
 * @property {number} issuedAt `iat`, en secondes depuis l’époque Unix.
 * @property {number} expiresAt `exp`, en secondes depuis l’époque Unix.
 */

/**
 * Contrat de gestion des jetons d’accès.
 *
 * `verify()` doit contrôler la signature, les algorithmes autorisés, l’expiration,
 * l’émetteur, l’audience et le sujet. Elle lève `TokenExpiredError` pour un jeton
 * expiré et `InvalidTokenError` pour tout autre rejet.
 *
 * @typedef {object} TokenProvider
 * @property {(input: { subject: string }) => Promise<IssuedToken>} issue
 * @property {(token: string) => Promise<VerifiedTokenClaims>} verify
 */

/** @type {readonly string[]} */
export const TOKEN_PROVIDER_METHODS = Object.freeze(["issue", "verify"]);

/**
 * @param {unknown} provider
 * @returns {asserts provider is TokenProvider}
 * @throws {import("../errors.js").ContractViolationError}
 */
export function assertTokenProvider(provider) {
  assertImplements(provider, "TokenProvider", TOKEN_PROVIDER_METHODS);
}

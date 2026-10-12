/**
 * Identité validée d’un utilisateur authentifié.
 *
 * Le principal ne contient que des données non sensibles issues d’un jeton
 * vérifié. Il ne contient jamais le hash du mot de passe ni le jeton brut.
 * Il est figé pour empêcher les middlewares suivants de le modifier.
 *
 * @typedef {Readonly<{
 *   userId: string,
 *   tokenId: string,
 *   issuedAt: number,
 *   expiresAt: number
 * }>} AuthPrincipal
 */

/**
 * @param {import("./token-provider.js").VerifiedTokenClaims | import("./token-provider.js").IssuedToken} claims
 * @param {string} userId
 * @returns {AuthPrincipal}
 */
export function createAuthPrincipal(claims, userId) {
  return Object.freeze({
    userId,
    tokenId: claims.tokenId,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt
  });
}

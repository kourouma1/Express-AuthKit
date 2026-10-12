/**
 * Identité validée d’un utilisateur authentifié.
 *
 * Le principal ne contient que des données non sensibles issues d’un jeton
 * vérifié. Il ne contient jamais le hash du mot de passe ni le jeton brut.
 * Il est figé pour empêcher les middlewares suivants de le modifier.
 *
 * Les rôles et permissions viennent du repository, relu à chaque requête :
 * ils ne sont jamais écrits dans le jeton, et un changement de rôle
 * s’applique immédiatement.
 *
 * @typedef {Readonly<{
 *   userId: string,
 *   tokenId: string,
 *   issuedAt: number,
 *   expiresAt: number,
 *   roles: readonly string[],
 *   permissions: readonly string[]
 * }>} AuthPrincipal
 */

/**
 * @param {import("./token-provider.js").VerifiedTokenClaims | import("./token-provider.js").IssuedToken} claims
 * @param {{ id: string, roles: readonly string[], permissions: readonly string[] }} user
 * @returns {AuthPrincipal}
 */
export function createAuthPrincipal(claims, user) {
  return Object.freeze({
    userId: user.id,
    tokenId: claims.tokenId,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    roles: user.roles,
    permissions: user.permissions
  });
}

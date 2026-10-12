/**
 * Identifiants transmis par un client.
 *
 * @typedef {object} LoginCredentials
 * @property {string} identifier Identifiant de connexion (e-mail, nom d’utilisateur…).
 * @property {string} password Mot de passe en clair. Il n’est ni journalisé ni stocké.
 */

/**
 * Résultat d’une connexion réussie, envoyable tel quel dans une réponse HTTP.
 *
 * @typedef {object} LoginResult
 * @property {string} accessToken Jeton d’accès JWT signé.
 * @property {"Bearer"} tokenType Toujours `"Bearer"`.
 * @property {number} expiresIn Durée de vie du jeton, en secondes.
 * @property {import("./auth-principal.js").AuthPrincipal} principal Identité authentifiée.
 * @property {string} [refreshToken] Jeton de rafraîchissement (présent si `refreshTokens` est activé).
 * @property {number} [refreshExpiresIn] Durée de vie du jeton de rafraîchissement, en secondes.
 */

/**
 * Forme acceptée pour un identifiant d’utilisateur : texte, entier, BigInt ou ObjectId MongoDB.
 *
 * @typedef {string | number | bigint | { toHexString(): string }} UserIdInput
 */

/**
 * Cas d’usage d’authentification indépendants du framework.
 *
 * @typedef {object} AuthenticationService
 * @property {(credentials: LoginCredentials) => Promise<LoginResult>} login
 *   Authentifie un utilisateur. Renvoie `InvalidCredentialsError` pour un
 *   utilisateur inconnu, un mauvais mot de passe ou un compte désactivé.
 * @property {(refreshToken: string) => Promise<LoginResult>} refresh
 *   Échange un jeton de rafraîchissement contre une nouvelle paire de jetons (rotation).
 * @property {(refreshToken: string) => Promise<void>} logout
 *   Révoque la session liée au jeton de rafraîchissement.
 * @property {(userId: UserIdInput) => Promise<void>} revokeAllSessions
 *   Révoque toutes les sessions d’un utilisateur.
 * @property {(token: string) => Promise<import("./auth-principal.js").AuthPrincipal>} verifyAccessToken
 *   Vérifie un jeton et contrôle que son utilisateur existe et est toujours actif.
 */

export {};

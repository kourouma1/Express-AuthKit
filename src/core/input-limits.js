/**
 * Limites appliquées aux données non fiables avant tout traitement coûteux.
 *
 * Elles évitent l’épuisement des ressources par des valeurs trop longues tout
 * en restant largement au-dessus des besoins légitimes.
 *
 * @module core/input-limits
 */

/** Longueur maximale d’un e-mail selon la RFC 5321, suffisante aussi pour un nom d’utilisateur. */
export const MAX_IDENTIFIER_LENGTH = 320;

/** Suffisante pour les phrases de passe, tout en limitant le coût du hachage. */
export const MAX_PASSWORD_LENGTH = 1024;

/** Les jetons d’accès produits par cette bibliothèque font quelques centaines de caractères. */
export const MAX_TOKEN_LENGTH = 8192;

/** Les jetons de rafraîchissement émis font 43 caractères ; la marge couvre d’autres formats. */
export const MAX_REFRESH_TOKEN_LENGTH = 512;

/** Nombre maximal de rôles (ou de permissions) par utilisateur : borne le coût des vérifications. */
export const MAX_AUTHORITIES = 256;

/** Longueur maximale d’un nom de rôle ou de permission (par exemple « orders:write »). */
export const MAX_AUTHORITY_LENGTH = 128;

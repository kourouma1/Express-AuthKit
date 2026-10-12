import { normalizeConsumedRefreshToken } from "./contracts/refresh-token-store.js";
import { AUTH_FAILURE_REASONS, InvalidInputError, InvalidRefreshTokenError, attachUserId, callDependency } from "./errors.js";
import { MAX_REFRESH_TOKEN_LENGTH } from "./input-limits.js";
import { PUBLIC_MESSAGES } from "./messages.js";

/** 256 bits d’aléa : impossible à deviner, même avec beaucoup d’essais. */
const REFRESH_TOKEN_BYTES = 32;

/**
 * @typedef {import("./contracts/refresh-token-store.js").RefreshTokenStore} RefreshTokenStore
 * @typedef {import("./contracts/refresh-token-store.js").ConsumedRefreshToken} ConsumedRefreshToken
 */

/**
 * Gère le cycle de vie des jetons de rafraîchissement : émission, rotation,
 * détection de réutilisation et révocation.
 *
 * Les jetons sont des valeurs aléatoires opaques (pas des JWT) : ils ne
 * contiennent aucune information et ne valent que par leur présence dans le
 * stockage, ce qui permet de les révoquer à tout moment.
 *
 * @param {object} options
 * @param {RefreshTokenStore} options.store
 * @param {number} options.expiresInSeconds
 */
export function createRefreshTokenService({ store, expiresInSeconds }) {
  /**
   * Émet un nouveau jeton et l’enregistre (seulement son empreinte).
   *
   * @param {string} userId
   * @param {string} [familyId] Famille existante en cas de rotation ; nouvelle sinon.
   * @returns {Promise<{ token: string, expiresIn: number }>}
   */
  async function issue(userId, familyId = globalThis.crypto.randomUUID()) {
    const token = generateToken();
    const record = {
      tokenHash: await hashToken(token),
      userId,
      familyId,
      expiresAt: nowInSeconds() + expiresInSeconds
    };
    await callDependency("RefreshTokenStore.save", () => store.save(record));
    return { token, expiresIn: expiresInSeconds };
  }

  /**
   * Consomme un jeton pour une rotation. Un jeton déjà utilisé signale un vol
   * probable : toute sa famille est alors révoquée.
   *
   * @param {unknown} token
   * @returns {Promise<ConsumedRefreshToken & { tokenHash: string }>}
   * @throws {InvalidInputError | InvalidRefreshTokenError}
   */
  async function consume(token) {
    const tokenHash = await hashToken(assertRefreshTokenShape(token));
    const consumed = await consumeRecord(tokenHash);
    if (consumed === null) {
      throw new InvalidRefreshTokenError(AUTH_FAILURE_REASONS.REFRESH_TOKEN_UNKNOWN);
    }
    if (consumed.alreadyUsed) {
      await revokeFamily(consumed.familyId);
      throw attachUserId(new InvalidRefreshTokenError(AUTH_FAILURE_REASONS.REFRESH_TOKEN_REUSED), consumed.userId);
    }
    if (consumed.expiresAt <= nowInSeconds()) {
      throw attachUserId(new InvalidRefreshTokenError(AUTH_FAILURE_REASONS.REFRESH_TOKEN_EXPIRED), consumed.userId);
    }
    return { ...consumed, tokenHash };
  }

  /**
   * Après l’enregistrement du nouveau jeton d’une rotation, vérifie que l’ancien
   * jeton existe toujours. Une révocation (déconnexion, `revokeUser`, vol
   * détecté) survenue pendant la rotation l’a supprimé : le nouveau jeton,
   * enregistré trop tard pour être révoqué avec la famille, est alors révoqué ici.
   *
   * Sans risque de course : soit la révocation a eu lieu avant cette
   * vérification (l’ancien jeton a disparu), soit après, et elle a alors aussi
   * supprimé le nouveau jeton, déjà enregistré.
   *
   * @param {{ tokenHash: string, familyId: string, userId: string }} previous
   * @returns {Promise<void>}
   * @throws {InvalidRefreshTokenError}
   */
  async function assertRotationNotRevoked(previous) {
    // L’ancien jeton est déjà marqué comme utilisé : le consommer à nouveau ne
    // change rien, et renvoie null seulement s’il a été révoqué.
    if ((await consumeRecord(previous.tokenHash)) === null) {
      await revokeFamily(previous.familyId);
      throw attachUserId(new InvalidRefreshTokenError(AUTH_FAILURE_REASONS.REFRESH_TOKEN_UNKNOWN), previous.userId);
    }
  }

  /**
   * Révoque la session à laquelle appartient le jeton. Ne lève pas d’erreur si
   * le jeton est inconnu, expiré ou déjà révoqué : une déconnexion répétée doit
   * réussir.
   *
   * @param {unknown} token
   * @returns {Promise<string | undefined>} L'utilisateur de la session révoquée, s'il est connu.
   */
  async function revokeSessionOf(token) {
    const consumed = await consumeRecord(await hashToken(assertRefreshTokenShape(token)));
    if (consumed !== null) {
      await revokeFamily(consumed.familyId);
    }
    return consumed?.userId;
  }

  /**
   * @param {string} familyId
   * @returns {Promise<void>}
   */
  function revokeFamily(familyId) {
    return callDependency("RefreshTokenStore.revokeFamily", () => store.revokeFamily(familyId));
  }

  /**
   * @param {string} userId
   * @returns {Promise<void>}
   */
  function revokeUser(userId) {
    return callDependency("RefreshTokenStore.revokeUser", () => store.revokeUser(userId));
  }

  /**
   * @param {string} tokenHash
   * @returns {Promise<ConsumedRefreshToken | null>}
   */
  async function consumeRecord(tokenHash) {
    return normalizeConsumedRefreshToken(
      await callDependency("RefreshTokenStore.consume", () => store.consume(tokenHash))
    );
  }

  return Object.freeze({ issue, consume, assertRotationNotRevoked, revokeSessionOf, revokeFamily, revokeUser });
}

/**
 * @param {unknown} token
 * @returns {string}
 * @throws {InvalidInputError}
 */
function assertRefreshTokenShape(token) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_REFRESH_TOKEN_LENGTH) {
    throw new InvalidInputError(PUBLIC_MESSAGES.refreshTokenMalformed);
  }
  return token;
}

/**
 * @returns {string} 32 octets aléatoires encodés en base64url (43 caractères).
 */
function generateToken() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(REFRESH_TOKEN_BYTES));
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Empreinte SHA-256 en hexadécimal. Un hachage rapide suffit ici : le jeton a
 * 256 bits d’aléa, il ne peut pas être retrouvé par force brute (contrairement
 * à un mot de passe, qui exige Argon2id).
 *
 * @param {string} token
 * @returns {Promise<string>}
 */
async function hashToken(token) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

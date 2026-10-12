import { SignJWT, errors as joseErrors, jwtVerify } from "jose";

import { resolveJwtOptions } from "../config/jwt-options.js";
import { InvalidInputError, InvalidTokenError, TokenExpiredError } from "../core/errors.js";
import { MAX_TOKEN_LENGTH } from "../core/input-limits.js";
import { subjectInvalid } from "../core/messages.js";

/**
 * Type de média RFC 9068 pour les jetons d’accès JWT. L’exiger lors de la
 * vérification empêche d’autres JWT signés avec la même clé (jetons d’identité,
 * liens de confirmation d’e-mail…) d’être acceptés comme jetons d’accès.
 */
const ACCESS_TOKEN_TYPE = "at+jwt";
const REQUIRED_CLAIMS = Object.freeze(["sub", "iss", "aud", "exp", "iat", "jti"]);
const MAX_SUBJECT_LENGTH = 256;

/**
 * Crée un {@link import("../core/contracts/token-provider.js").TokenProvider}
 * qui émet et vérifie des jetons d’accès JWT signés en HMAC avec `jose`.
 *
 * Les jetons ne contiennent que des revendications standard (`sub`, `iss`,
 * `aud`, `iat`, `exp`, `jti`) : aucune donnée personnelle ou sensible n’est
 * placée dans la charge utile, qui est encodée mais non chiffrée.
 *
 * @param {import("../config/jwt-options.js").JwtOptions} options
 * @returns {import("../core/contracts/token-provider.js").TokenProvider}
 * @throws {import("../core/errors.js").ConfigurationError}
 */
export function createJwtTokenProvider(options) {
  const config = resolveJwtOptions(options);

  const verifyOptions = Object.freeze({
    algorithms: [config.algorithm],
    issuer: config.issuer,
    audience: config.audience,
    typ: ACCESS_TOKEN_TYPE,
    clockTolerance: config.clockToleranceSeconds,
    // Also makes jose reject tokens whose `iat` lies in the future, and tokens
    // older than the configured lifetime (e.g. after shortening it).
    maxTokenAge: config.expiresInSeconds,
    requiredClaims: [...REQUIRED_CLAIMS]
  });

  /**
   * @param {{ subject: string }} input
   * @returns {Promise<import("../core/contracts/token-provider.js").IssuedToken>}
   */
  async function issue(input) {
    const subject = input?.subject;
    if (typeof subject !== "string" || subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) {
      throw new InvalidInputError(subjectInvalid(MAX_SUBJECT_LENGTH));
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + config.expiresInSeconds;
    const tokenId = globalThis.crypto.randomUUID();

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: config.algorithm, typ: ACCESS_TOKEN_TYPE })
      .setSubject(subject)
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(tokenId)
      .sign(config.key);

    return { token, tokenId, issuedAt, expiresAt };
  }

  /**
   * @param {string} token
   * @returns {Promise<import("../core/contracts/token-provider.js").VerifiedTokenClaims>}
   */
  async function verify(token) {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw new InvalidTokenError();
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, config.key, verifyOptions));
    } catch (error) {
      throw toTokenError(error);
    }

    const { sub, jti, iat, exp } = payload;
    if (typeof sub !== "string" || sub.length === 0 || sub.length > MAX_SUBJECT_LENGTH || typeof jti !== "string") {
      throw new InvalidTokenError();
    }
    return { subject: sub, tokenId: jti, issuedAt: /** @type {number} */ (iat), expiresAt: /** @type {number} */ (exp) };
  }

  return Object.freeze({ issue, verify });
}

/**
 * Convertit les erreurs de `jose` en erreurs de la bibliothèque. Toute erreur
 * qui ne vient pas de JOSE est inattendue et est propagée sans modification.
 *
 * @param {unknown} error
 * @returns {unknown}
 */
function toTokenError(error) {
  if (error instanceof joseErrors.JWTExpired) {
    return new TokenExpiredError({ cause: error });
  }
  if (error instanceof joseErrors.JOSEError) {
    return new InvalidTokenError({ cause: error });
  }
  return error;
}

import { InvalidInputError, callDependency } from "../core/errors.js";
import { MAX_PASSWORD_LENGTH } from "../core/input-limits.js";
import { DEVELOPER_MESSAGES, fieldRequired, fieldTooLong, pwnedHttpError } from "../core/messages.js";

const DEFAULT_ENDPOINT = "https://api.pwnedpasswords.com/range/";
const DEFAULT_TIMEOUT_MS = 3000;
/** Une réponse réelle fait environ 30 Kio (rembourrage compris) : au-delà, elle est refusée. */
const MAX_RESPONSE_BYTES = 256 * 1024;
const RANGE_LINE = /^[0-9A-F]{35}:\d+$/i;

/**
 * Indique si un mot de passe figure dans des fuites de données connues, grâce au
 * service gratuit « Have I Been Pwned » (Pwned Passwords).
 *
 * Confidentialité (k-anonymat) : seuls les 5 premiers caractères de l'empreinte
 * SHA-1 du mot de passe sont envoyés. Le service renvoie toutes les empreintes
 * qui commencent ainsi, et la comparaison se fait ici. Ni le mot de passe ni son
 * empreinte complète ne quittent le serveur. Les réponses sont « rembourrées »
 * (en-tête Add-Padding) pour ne rien révéler par leur taille.
 *
 * À utiliser à l'inscription et au changement de mot de passe, pas à la connexion.
 *
 * @example
 * if (await isPasswordCompromised(req.body.password)) {
 *   // refuser ce mot de passe
 * }
 *
 * @param {string} password
 * @param {{ fetch?: typeof globalThis.fetch, timeoutMs?: number, endpoint?: string }} [options]
 *   `fetch` est remplaçable (tests, proxy d'entreprise).
 * @returns {Promise<boolean>}
 * @throws {InvalidInputError} Mot de passe vide ou trop long.
 * @throws {import("../core/errors.js").DependencyFailureError} Service injoignable ou réponse invalide :
 *   à vous de décider s'il faut alors accepter ou refuser le mot de passe. Une réponse
 *   illisible n'est jamais interprétée comme « non compromis ».
 */
export async function isPasswordCompromised(password, options) {
  if (typeof password !== "string" || password.length === 0) {
    throw new InvalidInputError(fieldRequired("password"));
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new InvalidInputError(fieldTooLong("password", MAX_PASSWORD_LENGTH));
  }
  const fetchFn = options?.fetch ?? globalThis.fetch;
  const endpoint = options?.endpoint ?? DEFAULT_ENDPOINT;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const digest = await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
  const hex = Buffer.from(digest).toString("hex").toUpperCase();
  const prefix = hex.slice(0, 5);
  const suffix = hex.slice(5);

  const lines = await callDependency("PwnedPasswords.range", async () => {
    const response = await fetchFn(`${endpoint}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "express-authkit" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(pwnedHttpError(response.status));
    }
    const body = await response.text();
    // Chaque ligne : « SUFFIXE:NOMBRE ». Une page HTML (portail captif, proxy)
    // ou une réponse vide est une panne, pas un « mot de passe sûr ».
    const parsed = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    if (body.length > MAX_RESPONSE_BYTES || parsed.length === 0 || !parsed.every((line) => RANGE_LINE.test(line))) {
      throw new Error(DEVELOPER_MESSAGES.pwnedResponseInvalid);
    }
    return parsed;
  });

  // Les lignes de rembourrage ont un nombre à 0.
  return lines.some((line) => {
    const [candidate, count] = line.split(":");
    return candidate.toUpperCase() === suffix && Number(count) > 0;
  });
}

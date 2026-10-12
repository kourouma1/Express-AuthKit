import { normalizeAttemptCounter } from "./contracts/attempt-store.js";
import { TooManyAttemptsError, callDependency } from "./errors.js";

/**
 * @typedef {import("./contracts/attempt-store.js").AttemptStore} AttemptStore
 */

/**
 * Tentative autorisée et déjà comptée.
 *
 * @typedef {object} AttemptReservation
 * @property {boolean} locksOnFailure `true` si un échec de cette tentative bloque le compte.
 * @property {number} retryAfterSeconds Temps restant avant la fin de la fenêtre du compte.
 */

/**
 * Limite les tentatives de connexion, à deux niveaux :
 *
 * - **par identifiant** : au plus `maxFailuresPerIdentifier` tentatives par fenêtre ;
 *   une connexion réussie remet le compteur à zéro, si bien qu’en pratique seuls
 *   les échecs bloquent le compte (verrouillage temporaire) ;
 * - **par client** (adresse IP) : au plus `maxAttemptsPerClient` tentatives par
 *   fenêtre, réussies ou non, pour freiner une machine qui essaie de nombreux comptes.
 *
 * Chaque tentative est **comptée avant** la vérification du mot de passe, par une
 * opération atomique du stockage (`hit`). Des requêtes envoyées en parallèle ne
 * peuvent donc pas dépasser la limite : la 6e est refusée même si les 5 premières
 * sont encore en cours de vérification. Un attaquant bloqué ne coûte aucun calcul
 * Argon2id. Les identifiants inexistants sont traités de la même façon, pour ne
 * rien révéler de l’existence des comptes.
 *
 * @param {object} options
 * @param {AttemptStore} options.store
 * @param {number} options.maxFailuresPerIdentifier
 * @param {number} options.maxAttemptsPerClient
 * @param {number} options.windowSeconds
 */
export function createAttemptLimiter({ store, maxFailuresPerIdentifier, maxAttemptsPerClient, windowSeconds }) {
  /** @param {string} key */
  const hit = async (key) =>
    normalizeAttemptCounter(await callDependency("AttemptStore.hit", () => store.hit(key, windowSeconds)), windowSeconds);

  /**
   * Compte la tentative pour le client puis pour l’identifiant, et refuse si
   * l’une des deux limites est dépassée.
   *
   * @param {string} identifier
   * @param {string | undefined} clientKey
   * @returns {Promise<AttemptReservation>}
   * @throws {TooManyAttemptsError}
   */
  async function reserve(identifier, clientKey) {
    if (clientKey !== undefined) {
      const client = await hit(await clientCounterKey(clientKey));
      assertUnder(client, maxAttemptsPerClient, "client");
    }
    // Un client déjà bloqué ne fait pas avancer le compteur du compte visé.
    const account = await hit(await identifierCounterKey(identifier));
    assertUnder(account, maxFailuresPerIdentifier, "identifier");
    return {
      locksOnFailure: account.count === maxFailuresPerIdentifier,
      retryAfterSeconds: Math.max(0, account.resetAt - nowInSeconds())
    };
  }

  /**
   * Remet à zéro le compteur du compte après une connexion réussie.
   *
   * @param {string} identifier
   * @returns {Promise<void>}
   */
  async function recordSuccess(identifier) {
    const key = await identifierCounterKey(identifier);
    await callDependency("AttemptStore.reset", () => store.reset(key));
  }

  return Object.freeze({ reserve, recordSuccess });
}

/**
 * @param {import("./contracts/attempt-store.js").AttemptCounter} counter
 * @param {number} max
 * @param {"identifier" | "client"} scope
 */
function assertUnder(counter, max, scope) {
  if (counter.count > max) {
    throw new TooManyAttemptsError(counter.resetAt - nowInSeconds(), scope);
  }
}

/**
 * Forme canonique d’un identifiant pour le compteur : NFKC, sans espaces autour,
 * en minuscules. « Alice@Example.com », « alice@example.com » et leurs variantes
 * Unicode compatibles partagent donc le même compteur.
 *
 * @param {string} identifier
 */
function identifierCounterKey(identifier) {
  return hashKey("login:id:", identifier.normalize("NFKC").trim().toLowerCase());
}

/** @param {string} clientKey */
function clientCounterKey(clientKey) {
  return hashKey("login:client:", clientKey);
}

/**
 * Clé de stockage : empreinte SHA-256, pour qu’aucun e-mail ni adresse IP
 * n’apparaisse tel quel dans le stockage. C’est une pseudonymisation, pas un
 * anonymat : une empreinte d’adresse IP ou d’e-mail connu peut être recalculée.
 *
 * @param {string} prefix
 * @param {string} value
 * @returns {Promise<string>}
 */
async function hashKey(prefix, value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return prefix + Buffer.from(digest).toString("hex");
}

function nowInSeconds() {
  return Date.now() / 1000;
}

/**
 * Stockage des jetons de rafraîchissement en mémoire.
 *
 * ⚠️ Réservé au développement et aux tests : les jetons sont perdus au
 * redémarrage et ne sont pas partagés entre plusieurs processus ou serveurs.
 * En production, implémentez le contrat `RefreshTokenStore` avec votre base
 * de données (voir docs/refresh-tokens.md).
 *
 * @returns {import("../core/contracts/refresh-token-store.js").RefreshTokenStore}
 */
export function createInMemoryRefreshTokenStore() {
  /** @type {Map<string, { userId: string, familyId: string, expiresAt: number, used: boolean }>} */
  const records = new Map();

  /** @param {(record: { userId: string, familyId: string, expiresAt: number, used: boolean }) => boolean} predicate */
  function deleteWhere(predicate) {
    for (const [tokenHash, record] of records) {
      if (predicate(record)) {
        records.delete(tokenHash);
      }
    }
  }

  return Object.freeze({
    async save({ tokenHash, userId, familyId, expiresAt }) {
      // Nettoyage au fil de l’eau : la mémoire ne grossit pas indéfiniment.
      const now = Math.floor(Date.now() / 1000);
      deleteWhere((record) => record.expiresAt <= now);
      records.set(tokenHash, { userId, familyId, expiresAt, used: false });
    },

    async consume(tokenHash) {
      const record = records.get(tokenHash);
      if (record === undefined) {
        return null;
      }
      // Lecture et marquage dans le même tour de boucle : atomique en JavaScript.
      const alreadyUsed = record.used;
      record.used = true;
      return { userId: record.userId, familyId: record.familyId, expiresAt: record.expiresAt, alreadyUsed };
    },

    async revokeFamily(familyId) {
      deleteWhere((record) => record.familyId === familyId);
    },

    async revokeUser(userId) {
      deleteWhere((record) => record.userId === userId);
    }
  });
}

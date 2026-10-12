import { randomUUID } from "node:crypto";

/**
 * Repository utilisateur en mémoire, pour la démonstration et les tests.
 *
 * En production, remplacez-le par une implémentation basée sur votre base de
 * données (voir docs/repository-utilisateur.md). Le contrat attendu par
 * Express AuthKit se limite à findByIdentifier() et findById().
 */
export class InMemoryUserRepository {
  /** @type {Map<string, { id: string, email: string, name: string, passwordHash: string, isActive: boolean }>} */
  #users = new Map();

  /**
   * @param {{ email: string, name: string, passwordHash: string, isActive?: boolean }} input
   */
  create({ email, name, passwordHash, isActive = true }) {
    const user = { id: randomUUID(), email: normalizeEmail(email), name, passwordHash, isActive };
    this.#users.set(user.id, user);
    return toPublicProfile(user);
  }

  /** Contrat UserRepository : recherche par identifiant de connexion. */
  async findByIdentifier(identifier) {
    const email = normalizeEmail(identifier);
    for (const user of this.#users.values()) {
      if (user.email === email) {
        return toAuthRecord(user);
      }
    }
    return null;
  }

  /** Contrat UserRepository : recherche par identifiant du token (`sub`). */
  async findById(id) {
    const user = this.#users.get(id);
    return user ? toAuthRecord(user) : null;
  }

  /** Méthode propre à l'application : jamais de passwordHash dans un profil public. */
  async findPublicProfile(id) {
    const user = this.#users.get(id);
    return user ? toPublicProfile(user) : null;
  }

  /**
   * @param {string} id
   * @param {boolean} isActive
   */
  setActive(id, isActive) {
    const user = this.#users.get(id);
    if (user) user.isActive = isActive;
  }
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function toAuthRecord(user) {
  return { id: user.id, passwordHash: user.passwordHash, isActive: user.isActive };
}

function toPublicProfile(user) {
  return { id: user.id, email: user.email, name: user.name };
}

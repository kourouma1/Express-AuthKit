import { randomBytes } from "node:crypto";

import { createAuthKit } from "../../src/index.js";

/** Généré à chaque exécution : aucun secret n’est enregistré dans le dépôt. */
export const TEST_SECRET = randomBytes(48).toString("base64url");

export const TEST_ISSUER = "authkit-tests";
export const TEST_AUDIENCE = "authkit-test-client";

/** Coûts Argon2id minimums acceptés, afin de garder les tests rapides. */
export const FAST_ARGON2 = Object.freeze({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });

export const TEST_PASSWORD = "correct horse battery staple";

/**
 * @param {Partial<import("../../src/config/jwt-options.js").JwtOptions>} [overrides]
 */
export function jwtOptions(overrides = {}) {
  return { secret: TEST_SECRET, issuer: TEST_ISSUER, audience: TEST_AUDIENCE, ...overrides };
}

/**
 * Dépôt en mémoire qui enregistre les appels. Les utilisateurs peuvent être
 * modifiés durant un test pour simuler une désactivation ou une suppression.
 *
 * @param {Array<{ id: string, email: string, passwordHash: string, isActive: boolean }>} [initialUsers]
 */
export function createInMemoryUserRepository(initialUsers = []) {
  const users = new Map(initialUsers.map((user) => [user.id, { ...user }]));
  const calls = { findByIdentifier: [], findById: [] };

  return {
    users,
    calls,
    async findByIdentifier(identifier) {
      calls.findByIdentifier.push(identifier);
      const normalized = identifier.trim().toLowerCase();
      for (const user of users.values()) {
        if (user.email === normalized) {
          return { id: user.id, passwordHash: user.passwordHash, isActive: user.isActive };
        }
      }
      return null;
    },
    async findById(id) {
      calls.findById.push(id);
      const user = users.get(id);
      return user ? { id: user.id, passwordHash: user.passwordHash, isActive: user.isActive } : null;
    }
  };
}

/**
 * Construit un vrai moteur (Argon2id + JWT) avec un utilisateur actif et un
 * utilisateur désactivé.
 *
 * @param {object} [options]
 * @param {Partial<import("../../src/config/jwt-options.js").JwtOptions>} [options.jwt]
 */
export async function createTestAuthKit(options = {}) {
  const repository = createInMemoryUserRepository();
  const auth = createAuthKit({ users: repository, jwt: jwtOptions(options.jwt), password: FAST_ARGON2 });

  const passwordHash = await auth.password.hash(TEST_PASSWORD);
  repository.users.set("user-1", { id: "user-1", email: "alice@example.test", passwordHash, isActive: true });
  repository.users.set("user-2", { id: "user-2", email: "bob@example.test", passwordHash, isActive: false });

  return { auth, repository };
}

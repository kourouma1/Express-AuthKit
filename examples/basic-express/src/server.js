import { createAuthKit, createInMemoryRefreshTokenStore } from "express-authkit";

import { createApp } from "./app.js";
import { InMemoryUserRepository } from "./in-memory-user-repository.js";
import { createLoginRateLimiters, createRedisStoreFactory } from "./rate-limit.js";

/**
 * Point d'entrée : lit l'environnement, assemble les dépendances, démarre HTTP.
 * Une configuration invalide (secret absent ou faible...) arrête le processus.
 */
async function main() {
  const users = new InMemoryUserRepository();

  const auth = createAuthKit({
    users,
    jwt: {
      secret: process.env.AUTH_SECRET,
      issuer: "express-authkit-example",
      audience: "express-authkit-example-client",
      expiresInSeconds: 900
    },
    // En mémoire pour la démonstration : en production, utilisez votre base
    // de données (voir docs/refresh-tokens.md).
    refreshTokens: { store: createInMemoryRefreshTokenStore() }
  });

  await seedDemoUser(auth, users);

  const redis = process.env.REDIS_URL ? await createRedisStoreFactory(process.env.REDIS_URL) : undefined;
  if (!redis) {
    console.warn("REDIS_URL non défini : compteurs de rate limiting en mémoire (une seule instance).");
  }

  const app = createApp({
    auth,
    users,
    loginRateLimiters: createLoginRateLimiters({ createStore: redis?.createStore }),
    trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "0", 10)
  });

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const server = app.listen(port, () => {
    console.log(`Exemple Express AuthKit à l'écoute sur http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await redis?.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * @param {import("express-authkit").AuthKit} auth
 * @param {InMemoryUserRepository} users
 */
async function seedDemoUser(auth, users) {
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("DEMO_USER_EMAIL et DEMO_USER_PASSWORD doivent être définis (voir .env.example).");
  }
  const passwordHash = await auth.password.hash(password);
  users.create({ email, name: "Utilisateur de démonstration", passwordHash });
  console.log(`Utilisateur de démonstration créé : ${email}`);
}

main().catch((error) => {
  // Seuls le type et le message sont affichés : ils ne contiennent aucun secret.
  console.error(`Démarrage impossible : ${error.name}: ${error.message}`);
  process.exit(1);
});

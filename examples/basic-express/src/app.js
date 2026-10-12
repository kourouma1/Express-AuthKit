import express from "express";
import { createExpressAuth } from "@kourouma/express-authkit/express";

import { createLoginRateLimiters } from "./rate-limit.js";

/**
 * Construit l'application Express. Aucune dépendance n'est créée ici :
 * tout est injecté, ce qui rend l'application facile à tester.
 *
 * @param {object} dependencies
 * @param {import("@kourouma/express-authkit").AuthKit} dependencies.auth
 * @param {import("./in-memory-user-repository.js").InMemoryUserRepository} dependencies.users
 * @param {import("express").RequestHandler[]} [dependencies.loginRateLimiters]
 * @param {number} [dependencies.trustProxyHops]
 */
export function createApp({ auth, users, loginRateLimiters = createLoginRateLimiters(), trustProxyHops = 0 }) {
  const expressAuth = createExpressAuth(auth);
  const app = express();

  // Indispensable derrière un load balancer pour que req.ip soit l'IP du client
  // (et non celle du proxy), sinon le rate limiting par IP est inefficace.
  app.set("trust proxy", trustProxyHops);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Handlers prêts à l'emploi : connexion, rafraîchissement et déconnexion.
  app.post("/auth/login", ...loginRateLimiters, expressAuth.login());
  app.post("/auth/refresh", expressAuth.refresh());
  app.post("/auth/logout", expressAuth.logout());

  // Déconnexion de tous les appareils de l'utilisateur connecté.
  app.post("/auth/logout-all", expressAuth.authenticate(), async (req, res, next) => {
    try {
      await auth.revokeAllSessions(req.auth.userId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/me", expressAuth.authenticate(), async (req, res, next) => {
    try {
      const profile = await users.findPublicProfile(req.auth.userId);
      res.json({ userId: req.auth.userId, profile });
    } catch (error) {
      next(error);
    }
  });

  // Réservé aux administrateurs : 401 sans token, 403 sans le rôle « admin ».
  app.get("/admin/stats", expressAuth.authorize("admin"), (req, res) => {
    res.json({ message: "Statistiques réservées aux administrateurs." });
  });

  // Erreurs du client (JSON invalide, corps trop gros…) : réponses JSON propres en français.
  app.use(expressAuth.errorHandler());

  // Filet de sécurité final : on journalise côté serveur, sans rien révéler au client.
  app.use((error, req, res, _next) => {
    // Ni corps de requête, ni en-tête Authorization dans les journaux.
    // Pour une DependencyFailureError, error.dependency indique quel appel a échoué.
    const origin = error.dependency ? ` (${error.dependency})` : "";
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} : ${error.name} ${error.code ?? ""}${origin}`);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erreur interne du serveur." } });
  });

  return app;
}

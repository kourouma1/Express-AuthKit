import express from "express";
import { createExpressAuth } from "express-authkit/express";

import { createLoginRateLimiters } from "./rate-limit.js";

/**
 * Construit l'application Express. Aucune dépendance n'est créée ici :
 * tout est injecté, ce qui rend l'application facile à tester.
 *
 * @param {object} dependencies
 * @param {import("express-authkit").AuthKit} dependencies.auth
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

  app.post("/auth/login", ...loginRateLimiters, async (req, res, next) => {
    try {
      const result = await auth.login({
        identifier: req.body?.identifier,
        password: req.body?.password
      });
      res.set("Cache-Control", "no-store");
      res.json({ accessToken: result.accessToken, tokenType: result.tokenType, expiresIn: result.expiresIn });
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

  // Convertit les erreurs d'authentification (login) en réponses JSON 400/401.
  app.use(expressAuth.errorHandler());

  // Filet de sécurité final : aucune information interne n'est renvoyée.
  app.use((error, req, res, _next) => {
    if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
      res.status(error.status).json({ error: { code: "INVALID_REQUEST", message: "Invalid request body." } });
      return;
    }
    // Journalisez ici avec votre logger (sans corps de requête ni en-tête Authorization).
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} failed: ${error.name} ${error.code ?? ""}`);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
  });

  return app;
}

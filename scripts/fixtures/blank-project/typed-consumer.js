// @ts-check
// Vérifié par TypeScript (tsc --checkJs) contre les types publiés : il prouve que
// l'autocomplétion et les erreurs de type fonctionnent chez un utilisateur.
// Chaque « @ts-expect-error » doit réellement produire une erreur : si les types
// étaient absents (any), la vérification échouerait.
import express from "express";
import {
  AUDIT_EVENTS,
  AUTH_ERROR_CODES,
  TooManyAttemptsError,
  createAuthKit,
  createInMemoryAttemptStore,
  createInMemoryRefreshTokenStore,
  isAuthKitError,
  isPasswordCompromised
} from "@express-authkit/core";
import { clientKeyOf, createExpressAuth } from "@express-authkit/core/express";

/** @type {import("@express-authkit/core").UserRepository} */
const users = {
  async findByIdentifier(identifier) {
    return identifier === "alice@example.com" ? { id: 1, passwordHash: "$argon2id$…", isActive: true } : null;
  },
  async findById() {
    return null;
  }
};

const auth = createAuthKit({
  users,
  jwt: { secret: "unused-at-type-level", issuer: "my-api", audience: "my-client" },
  refreshTokens: { store: createInMemoryRefreshTokenStore() },
  loginAttempts: { store: createInMemoryAttemptStore({ maxEntries: 1000 }), maxFailuresPerIdentifier: 5 },
  /** @param {import("@express-authkit/core").AuditEvent} event */
  audit: (event) => {
    /** @type {string} */
    const type = event.type;
    return type === AUDIT_EVENTS.LOGIN_FAILED ? event.reason : undefined;
  }
});

/** @type {import("@express-authkit/core").AttemptStore} */
export const redisLikeStore = {
  async hit(key, windowSeconds) {
    return { count: key.length, resetAt: Date.now() / 1000 + windowSeconds };
  },
  async reset() {}
};

/** @type {import("@express-authkit/core").LoginAttemptOptions} */
export const attempts = { store: redisLikeStore, windowSeconds: 900 };

// @ts-expect-error -- maxFailuresPerIdentifier est un nombre.
createAuthKit({ users, jwt: { secret: "s", issuer: "i", audience: "a" }, loginAttempts: { maxFailuresPerIdentifier: "5" } });

/** @param {import("@express-authkit/core").LoginResult} result */
export function readLogin(result) {
  /** @type {string} */
  const token = result.accessToken;
  /** @type {string | undefined} */
  const refreshToken = result.refreshToken;
  return { token, refreshToken, userId: result.principal.userId };
}

export async function useEngine() {
  const session = await auth.login({ identifier: "alice@example.com", password: "secret" });
  await auth.refresh(session.refreshToken ?? "");
  await auth.logout(session.refreshToken ?? "");
  await auth.revokeAllSessions(42);
  /** @type {boolean} */
  const matches = await auth.password.verify("a", "b");

  // @ts-expect-error -- login() exige un objet { identifier, password }.
  await auth.login("alice@example.com");

  /** @type {boolean} */
  const compromised = await isPasswordCompromised("secret", { timeoutMs: 1000 });
  try {
    await auth.login({ identifier: "alice@example.com", password: "secret" }, { clientKey: "203.0.113.7" });
  } catch (error) {
    if (error instanceof TooManyAttemptsError) {
      /** @type {number} */
      const wait = error.retryAfterSeconds;
      return wait > 0 && compromised;
    }
  }

  try {
    await auth.verifyAccessToken("token");
  } catch (error) {
    if (isAuthKitError(error) && error.code === AUTH_ERROR_CODES.TOKEN_EXPIRED) {
      return matches;
    }
  }
  return matches;
}

// @ts-expect-error -- expiresInSeconds doit être un nombre, pas une durée en texte.
createAuthKit({ users, jwt: { secret: "s", issuer: "i", audience: "a", expiresInSeconds: "15m" } });

// @ts-expect-error -- l'option « users » est obligatoire.
createAuthKit({ jwt: { secret: "s", issuer: "i", audience: "a" } });

const expressAuth = createExpressAuth(auth);
const app = express();
app.post("/login", express.json(), expressAuth.login({ identifierField: "email" }));
app.post("/custom-login", express.json(), async (req, res) => {
  /** @type {string} */
  const clientKey = clientKeyOf(req);
  res.json(await auth.login({ identifier: req.body.email, password: req.body.password }, { clientKey }));
});
app.post("/refresh", express.json(), expressAuth.refresh());
app.get("/profile", expressAuth.authenticate(), (req, res) => {
  // req.auth est typé grâce à l'augmentation de Express.Request.
  /** @type {string | undefined} */
  const userId = req.auth?.userId;
  // @ts-expect-error -- req.auth ne contient pas le hash du mot de passe.
  res.json({ userId, hash: req.auth?.passwordHash });
});
app.get("/admin", expressAuth.authorize("admin"), (req, res) => {
  /** @type {readonly string[] | undefined} */
  const roles = req.auth?.roles;
  res.json({ roles });
});
app.put(
  "/users/:id",
  expressAuth.authorize({ anyRole: ["admin"], check: (user, req) => user.userId === req.params.id }),
  (req, res) => res.end()
);
// @ts-expect-error -- anyRole attend une liste de rôles, pas un texte.
expressAuth.authorize({ anyRole: "admin" });
app.use(expressAuth.errorHandler());

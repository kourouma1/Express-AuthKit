/**
 * Express AuthKit — adaptateur Express.js (`@express-authkit/core/express`).
 *
 * Ce module n’importe pas Express : il produit uniquement des middlewares
 * standard `(req, res, next)`, compatibles avec Express 4 et 5.
 *
 * @module @express-authkit/core/express
 */

import { AUDIT_EMITTER, AUDIT_EVENTS } from "../../core/audit.js";
import { assertImplements } from "../../core/contracts/assert-contract.js";
import { normalizeAuthorizationRequirement, isAuthorized } from "../../core/authorization.js";
import { AccessDeniedError, ConfigurationError, InvalidInputError } from "../../core/errors.js";
import { MAX_IDENTIFIER_LENGTH } from "../../core/input-limits.js";
import {
  DEVELOPER_MESSAGES,
  PUBLIC_MESSAGES,
  fieldRequired,
  fieldTooLong,
  middlewareFactoryMisuse
} from "../../core/messages.js";
import { assertKnownKeys, assertPlainObject } from "../../config/assertions.js";
import { extractBearerToken } from "./bearer-token.js";
import { clientKeyOf } from "./client-key.js";

export { clientKeyOf } from "./client-key.js";
import { getClientErrorStatus, resolveClientError, sendClientError } from "./http-errors.js";

/**
 * @typedef {object} ExpressAuthOptions
 * @property {string} [realm="api"] Domaine annoncé dans l’en-tête `WWW-Authenticate`.
 */

/**
 * Règle d’accès pour `expressAuth.authorize()`. Un texte désigne un rôle.
 * `check` reçoit l’utilisateur connecté et la requête Express.
 *
 * @typedef {string | {
 *   anyRole?: string[],
 *   allPermissions?: string[],
 *   check?: (user: import("../../core/contracts/auth-principal.js").AuthPrincipal, req: import("express").Request) => boolean | Promise<boolean>
 * }} ExpressAuthorizationRequirement
 */

/**
 * @typedef {object} LoginHandlerOptions
 * @property {string} [identifierField="identifier"] Champ du corps JSON contenant l’identifiant (par exemple `"email"`).
 */

/**
 * @typedef {Readonly<{
 *   authenticate: () => import("express").RequestHandler,
 *   authorize: (requirement: ExpressAuthorizationRequirement) => import("express").RequestHandler,
 *   login: (options?: LoginHandlerOptions) => import("express").RequestHandler,
 *   refresh: () => import("express").RequestHandler,
 *   logout: () => import("express").RequestHandler,
 *   errorHandler: () => import("express").ErrorRequestHandler
 * }>} ExpressAuth
 */

const DEFAULT_REALM = "api";
/** Jeu de caractères limité : le domaine est écrit dans un en-tête de réponse. */
const REALM_PATTERN = /^[A-Za-z0-9 ._-]{1,64}$/;
const DEFAULT_IDENTIFIER_FIELD = "identifier";
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Crée l’intégration Express pour un moteur construit avec `createAuthKit()`.
 *
 * @example
 * const expressAuth = createExpressAuth(auth);
 * app.post("/login", express.json(), expressAuth.login());
 * app.get("/profile", expressAuth.authenticate(), (req, res) => {
 *   res.json({ userId: req.auth.userId });
 * });
 *
 * @param {import("../../factory/create-auth-kit.js").AuthKit} auth
 * @param {ExpressAuthOptions} [options]
 * @returns {ExpressAuth}
 */
export function createExpressAuth(auth, options = {}) {
  assertImplements(auth, "AuthKit", ["login", "verifyAccessToken"]);
  assertPlainObject(options, "createExpressAuth(auth, options)");
  assertKnownKeys(options, ["realm"], "createExpressAuth(auth, options)");

  const realm = options.realm ?? DEFAULT_REALM;
  /** @type {(type: string, details?: Record<string, unknown>) => void} */
  const emitAudit = /** @type {any} */ (auth)[AUDIT_EMITTER] ?? (() => {});

  /**
   * Requêtes authentifiées par cette instance. `authorize()` ne fait confiance
   * qu’à elles : une valeur de `req.auth` posée par un autre middleware est
   * ignorée et ne peut pas usurper une identité.
   *
   * @type {WeakMap<object, import("../../core/contracts/auth-principal.js").AuthPrincipal>}
   */
  const authenticatedRequests = new WeakMap();
  if (typeof realm !== "string" || !REALM_PATTERN.test(realm)) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.invalidRealm);
  }

  /**
   * Middleware exigeant un en-tête `Authorization: Bearer <token>` valide.
   * En cas de succès, le principal figé est disponible dans `req.auth`.
   * Les échecs d’authentification reçoivent une réponse JSON 401 ; les erreurs
   * inattendues sont transmises à `next(error)`.
   *
   * @returns {import("express").RequestHandler}
   * @param {...unknown} unexpectedArguments Doit rester vide (détecte l’oubli des parenthèses).
   */
  function authenticate(...unexpectedArguments) {
    assertCalledAsFactory("authenticate", unexpectedArguments);
    return async function authenticateRequest(req, res, next) {
      let principal;
      try {
        principal = await verifyRequest(req);
      } catch (error) {
        failRequest(error, res, next);
        return;
      }
      setPrincipal(req, principal);
      next();
    };
  }

  /**
   * Protège une route par rôle, permission ou règle personnalisée. Authentifie
   * aussi la requête si `authenticate()` n’a pas été appelé avant : une seule
   * ligne suffit.
   *
   * Réponses : 401 si l’utilisateur n’est pas connecté, 403 (`ACCESS_DENIED`)
   * s’il est connecté mais n’a pas les droits.
   *
   * @example
   * app.get("/admin", expressAuth.authorize("admin"), handler);
   * app.post("/orders", expressAuth.authorize({ allPermissions: ["orders:write"] }), handler);
   * app.put("/users/:id", expressAuth.authorize({ check: (user, req) => user.userId === req.params.id }), handler);
   *
   * @param {ExpressAuthorizationRequirement} requirement
   * @param {...unknown} unexpectedArguments Doit rester vide (détecte l’oubli des parenthèses).
   * @returns {import("express").RequestHandler}
   */
  function authorize(requirement, ...unexpectedArguments) {
    assertCalledAsFactory("authorize", unexpectedArguments);
    // Validée une fois, au démarrage : une règle invalide arrête l’application.
    const rules = normalizeAuthorizationRequirement(requirement);

    return async function authorizeRequest(req, res, next) {
      try {
        const principal = await resolvePrincipal(req);
        if (!(await isAuthorized(principal, rules, req))) {
          emitAudit(AUDIT_EVENTS.ACCESS_DENIED, { userId: principal.userId, client: clientKeyOf(req), method: req.method, path: req.path });
          throw new AccessDeniedError();
        }
      } catch (error) {
        failRequest(error, res, next);
        return;
      }
      next();
    };
  }

  /**
   * Réutilise l’utilisateur déjà authentifié par `authenticate()` sur cette
   * requête, ou authentifie la requête maintenant.
   *
   * @param {import("express").Request} req
   * @returns {Promise<import("../../core/contracts/auth-principal.js").AuthPrincipal>}
   */
  async function resolvePrincipal(req) {
    const existing = authenticatedRequests.get(req);
    if (existing !== undefined) {
      return existing;
    }
    const principal = await verifyRequest(req);
    setPrincipal(req, principal);
    return principal;
  }

  /**
   * @param {import("express").Request} req
   * @returns {Promise<import("../../core/contracts/auth-principal.js").AuthPrincipal>}
   */
  function verifyRequest(req) {
    return auth.verifyAccessToken(extractBearerToken(req.headers.authorization), { clientKey: clientKeyOf(req) });
  }

  /**
   * Réponse commune à toutes les erreurs : JSON pour les erreurs client
   * (400, 401, 403, 429), `next(error)` pour les autres ou si la réponse a
   * déjà commencé.
   *
   * @param {unknown} error
   * @param {import("express").Response} res
   * @param {import("express").NextFunction} next
   */
  function failRequest(error, res, next) {
    const status = getClientErrorStatus(error);
    if (status !== undefined && !res.headersSent) {
      sendClientError(res, /** @type {import("../../core/errors.js").AuthKitError} */ (error), status, realm);
      return;
    }
    next(error);
  }

  /**
   * @param {import("express").Request} req
   * @param {import("../../core/contracts/auth-principal.js").AuthPrincipal} principal
   */
  function setPrincipal(req, principal) {
    authenticatedRequests.set(req, principal);
    /** @type {import("express").Request & { auth?: import("../../core/contracts/auth-principal.js").AuthPrincipal }} */ (
      req
    ).auth = principal;
  }

  /**
   * Gestionnaire de connexion prêt à l’emploi. Ce n’est pas une route
   * automatique : l’application choisit l’URL sur laquelle elle le monte.
   *
   * Lit `password` et l’identifiant (champ `identifier` par défaut) dans le
   * corps JSON, puis répond `{ accessToken, tokenType, expiresIn }`.
   * Les échecs reçoivent une réponse JSON 400/401 ; les erreurs inattendues
   * sont transmises à `next(error)`.
   *
   * @example
   * app.post("/login", express.json(), expressAuth.login());
   * app.post("/login", express.json(), expressAuth.login({ identifierField: "email" }));
   *
   * @param {LoginHandlerOptions} [loginOptions]
   * @returns {import("express").RequestHandler}
   * @param {...unknown} unexpectedArguments Doit rester vide (détecte l’oubli des parenthèses).
   */
  function login(loginOptions = {}, ...unexpectedArguments) {
    assertCalledAsFactory("login", unexpectedArguments);
    const identifierField = resolveIdentifierField(loginOptions);

    return handleJson(async (body, res, req) => {
      // Object.hasOwn évite de lire une propriété héritée du prototype.
      const identifier = Object.hasOwn(body, identifierField) ? body[identifierField] : undefined;
      const password = Object.hasOwn(body, "password") ? body.password : undefined;
      // Vérifié ici pour que le message cite le vrai nom du champ (« email »…).
      assertIdentifierField(identifier, identifierField);
      // Le client a déjà fermé la connexion : personne n’attend la réponse. Ne
      // rien calculer évite qu’une rafale de requêtes interrompues fasse
      // travailler Argon2id (et verrouille des comptes) sans être vue.
      if (req.socket?.destroyed) {
        return;
      }
      // Le type exact du mot de passe est vérifié par auth.login().
      const result = await auth.login({ identifier, password: /** @type {string} */ (password) }, { clientKey: clientKeyOf(req) });
      sendSession(res, result);
    });
  }

  /**
   * Gestionnaire de rafraîchissement : lit `refreshToken` dans le corps JSON
   * et répond avec une nouvelle paire de jetons (l’ancien jeton est invalidé).
   * Nécessite l’option `refreshTokens` de `createAuthKit()`.
   *
   * @example
   * app.post("/auth/refresh", express.json(), expressAuth.refresh());
   *
   * @returns {import("express").RequestHandler}
   * @param {...unknown} unexpectedArguments Doit rester vide (détecte l’oubli des parenthèses).
   */
  function refresh(...unexpectedArguments) {
    assertCalledAsFactory("refresh", unexpectedArguments);
    return handleJson(async (body, res) => {
      sendSession(res, await auth.refresh(readRefreshToken(body)));
    });
  }

  /**
   * Gestionnaire de déconnexion : lit `refreshToken` dans le corps JSON,
   * révoque la session et répond 204 (sans contenu). Répond 204 aussi si la
   * session était déjà révoquée : se déconnecter deux fois n’est pas une erreur.
   *
   * @example
   * app.post("/auth/logout", express.json(), expressAuth.logout());
   *
   * @returns {import("express").RequestHandler}
   * @param {...unknown} unexpectedArguments Doit rester vide (détecte l’oubli des parenthèses).
   */
  function logout(...unexpectedArguments) {
    assertCalledAsFactory("logout", unexpectedArguments);
    return handleJson(async (body, res) => {
      await auth.logout(readRefreshToken(body));
      res.set("Cache-Control", "no-store");
      res.status(204).end();
    });
  }

  /**
   * Enveloppe commune des gestionnaires qui lisent un corps JSON : les
   * erreurs client reçoivent une réponse JSON, les autres vont à `next()`.
   *
   * @param {(body: Record<string, unknown>, res: import("express").Response, req: import("express").Request) => Promise<void>} handle
   * @returns {import("express").RequestHandler}
   */
  function handleJson(handle) {
    return async function jsonRequest(req, res, next) {
      try {
        await handle(readJsonBody(req), res, req);
      } catch (error) {
        failRequest(error, res, next);
      }
    };
  }

  /**
   * Middleware d’erreur qui convertit les erreurs d’authentification client,
   * par exemple celles de `auth.login()`, en réponses JSON. Les autres erreurs
   * sont transmises sans modification au gestionnaire suivant.
   *
   * @returns {import("express").ErrorRequestHandler}
   * @param {...unknown} unexpectedArguments Doit rester vide (détecte l’oubli des parenthèses).
   */
  function errorHandler(...unexpectedArguments) {
    assertCalledAsFactory("errorHandler", unexpectedArguments);
    return function authErrorHandler(error, req, res, next) {
      const clientError = resolveClientError(error);
      if (clientError === undefined || res.headersSent) {
        next(error);
        return;
      }
      sendClientError(res, clientError.error, clientError.status, realm);
    };
  }

  return Object.freeze({ authenticate, authorize, login, refresh, logout, errorHandler });
}

/**
 * @param {unknown} loginOptions
 * @returns {string}
 */
function resolveIdentifierField(loginOptions) {
  assertPlainObject(loginOptions, "expressAuth.login(options)");
  assertKnownKeys(loginOptions, ["identifierField"], "expressAuth.login(options)");
  const field = loginOptions.identifierField ?? DEFAULT_IDENTIFIER_FIELD;
  if (typeof field !== "string" || !FIELD_NAME_PATTERN.test(field)) {
    throw new ConfigurationError(DEVELOPER_MESSAGES.invalidIdentifierField);
  }
  return field;
}

/**
 * Détecte l’oubli des parenthèses (`expressAuth.authenticate` au lieu de
 * `expressAuth.authenticate()`). Sans ce contrôle, Express appellerait la
 * fabrique comme un middleware et la requête resterait bloquée sans réponse.
 *
 * @param {string} method
 * @param {unknown[]} unexpectedArguments
 */
function assertCalledAsFactory(method, unexpectedArguments) {
  if (unexpectedArguments.length > 0) {
    throw new ConfigurationError(middlewareFactoryMisuse(method));
  }
}

/**
 * @param {unknown} identifier
 * @param {string} field
 * @returns {asserts identifier is string}
 */
function assertIdentifierField(identifier, field) {
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new InvalidInputError(fieldRequired(field));
  }
  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    throw new InvalidInputError(fieldTooLong(field, MAX_IDENTIFIER_LENGTH));
  }
}

/**
 * @param {import("express").Request} req
 * @returns {Record<string, unknown>}
 * @throws {InvalidInputError}
 */
function readJsonBody(req) {
  const body = req.body;
  if (body === undefined || body === null || typeof body !== "object") {
    throw new InvalidInputError(PUBLIC_MESSAGES.missingJsonBody);
  }
  return body;
}

/**
 * Lit le champ sans le valider : auth.refresh() et auth.logout() vérifient
 * eux-mêmes que c’est un texte non vide.
 *
 * @param {Record<string, unknown>} body
 * @returns {string} Type annoncé ; la valeur réelle est validée par le Core.
 */
function readRefreshToken(body) {
  const value = Object.hasOwn(body, "refreshToken") ? body.refreshToken : undefined;
  return /** @type {string} */ (value);
}

/**
 * Envoie une paire de jetons. Le principal interne n’est pas inclus.
 *
 * @param {import("express").Response} res
 * @param {import("../../core/contracts/authentication-service.js").LoginResult} result
 */
function sendSession(res, result) {
  /** @type {{ accessToken: string, tokenType: string, expiresIn: number, refreshToken?: string, refreshExpiresIn?: number }} */
  const body = { accessToken: result.accessToken, tokenType: result.tokenType, expiresIn: result.expiresIn };
  if (result.refreshToken !== undefined) {
    body.refreshToken = result.refreshToken;
    body.refreshExpiresIn = result.refreshExpiresIn;
  }
  res.set("Cache-Control", "no-store");
  res.json(body);
}

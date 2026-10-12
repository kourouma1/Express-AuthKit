/**
 * Express AuthKit — adaptateur Express.js (`express-authkit/express`).
 *
 * Ce module n’importe pas Express : il produit uniquement des middlewares
 * standard `(req, res, next)`, compatibles avec Express 4 et 5.
 *
 * @module express-authkit/express
 */

import { assertImplements } from "../../core/contracts/assert-contract.js";
import { ConfigurationError, InvalidInputError } from "../../core/errors.js";
import { assertKnownKeys, assertPlainObject } from "../../config/assertions.js";
import { extractBearerToken } from "./bearer-token.js";
import { getClientErrorStatus, sendClientError } from "./http-errors.js";

/**
 * @typedef {object} ExpressAuthOptions
 * @property {string} [realm="api"] Domaine annoncé dans l’en-tête `WWW-Authenticate`.
 */

/**
 * @typedef {object} LoginHandlerOptions
 * @property {string} [identifierField="identifier"] Champ du corps JSON contenant l’identifiant (par exemple `"email"`).
 */

/**
 * @typedef {Readonly<{
 *   authenticate: () => import("express").RequestHandler,
 *   login: (options?: LoginHandlerOptions) => import("express").RequestHandler,
 *   errorHandler: () => import("express").ErrorRequestHandler
 * }>} ExpressAuth
 */

const DEFAULT_REALM = "api";
/** Jeu de caractères limité : le domaine est écrit dans un en-tête de réponse. */
const REALM_PATTERN = /^[A-Za-z0-9 ._-]{1,64}$/;
const DEFAULT_IDENTIFIER_FIELD = "identifier";
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MISSING_JSON_BODY_MESSAGE =
  "Request body must be a JSON object: send `Content-Type: application/json` (and use express.json() on the server).";

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
  assertPlainObject(options, "options");
  assertKnownKeys(options, ["realm"], "options");

  const realm = options.realm ?? DEFAULT_REALM;
  if (typeof realm !== "string" || !REALM_PATTERN.test(realm)) {
    throw new ConfigurationError("`realm` must contain 1 to 64 letters, digits, spaces, dots, dashes or underscores.");
  }

  /**
   * Middleware exigeant un en-tête `Authorization: Bearer <token>` valide.
   * En cas de succès, le principal figé est disponible dans `req.auth`.
   * Les échecs d’authentification reçoivent une réponse JSON 401 ; les erreurs
   * inattendues sont transmises à `next(error)`.
   *
   * @returns {import("express").RequestHandler}
   */
  function authenticate() {
    return async function authenticateRequest(req, res, next) {
      let principal;
      try {
        const token = extractBearerToken(req.headers.authorization);
        principal = await auth.verifyAccessToken(token);
      } catch (error) {
        const status = getClientErrorStatus(error);
        if (status !== undefined) {
          sendClientError(res, error, status, realm);
          return;
        }
        next(error);
        return;
      }
      req.auth = principal;
      next();
    };
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
   */
  function login(loginOptions = {}) {
    const identifierField = resolveIdentifierField(loginOptions);

    return async function loginRequest(req, res, next) {
      let result;
      try {
        const body = req.body;
        if (body === undefined || body === null || typeof body !== "object") {
          throw new InvalidInputError(MISSING_JSON_BODY_MESSAGE);
        }
        result = await auth.login({
          // Object.hasOwn évite de lire une propriété héritée du prototype.
          identifier: Object.hasOwn(body, identifierField) ? body[identifierField] : undefined,
          password: Object.hasOwn(body, "password") ? body.password : undefined
        });
      } catch (error) {
        const status = getClientErrorStatus(error);
        if (status !== undefined) {
          sendClientError(res, error, status, realm);
          return;
        }
        next(error);
        return;
      }
      res.set("Cache-Control", "no-store");
      res.json({ accessToken: result.accessToken, tokenType: result.tokenType, expiresIn: result.expiresIn });
    };
  }

  /**
   * Middleware d’erreur qui convertit les erreurs d’authentification client,
   * par exemple celles de `auth.login()`, en réponses JSON. Les autres erreurs
   * sont transmises sans modification au gestionnaire suivant.
   *
   * @returns {import("express").ErrorRequestHandler}
   */
  function errorHandler() {
    return function authErrorHandler(error, req, res, next) {
      const status = getClientErrorStatus(error);
      if (status === undefined || res.headersSent) {
        next(error);
        return;
      }
      sendClientError(res, error, status, realm);
    };
  }

  return Object.freeze({ authenticate, login, errorHandler });
}

/**
 * @param {unknown} loginOptions
 * @returns {string}
 */
function resolveIdentifierField(loginOptions) {
  assertPlainObject(loginOptions, "login options");
  assertKnownKeys(loginOptions, ["identifierField"], "login options");
  const field = loginOptions.identifierField ?? DEFAULT_IDENTIFIER_FIELD;
  if (typeof field !== "string" || !FIELD_NAME_PATTERN.test(field)) {
    throw new ConfigurationError("`identifierField` must be a simple field name such as \"email\" or \"username\".");
  }
  return field;
}

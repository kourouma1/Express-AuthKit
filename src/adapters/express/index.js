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
import { getClientErrorStatus, resolveClientError, sendClientError } from "./http-errors.js";

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
   */
  function authenticate(...unexpectedArguments) {
    assertCalledAsFactory("authenticate", unexpectedArguments);
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
  function login(loginOptions = {}, ...unexpectedArguments) {
    assertCalledAsFactory("login", unexpectedArguments);
    const identifierField = resolveIdentifierField(loginOptions);

    return async function loginRequest(req, res, next) {
      let result;
      try {
        const body = req.body;
        if (body === undefined || body === null || typeof body !== "object") {
          throw new InvalidInputError(PUBLIC_MESSAGES.missingJsonBody);
        }
        // Object.hasOwn évite de lire une propriété héritée du prototype.
        const identifier = Object.hasOwn(body, identifierField) ? body[identifierField] : undefined;
        const password = Object.hasOwn(body, "password") ? body.password : undefined;
        // Vérifié ici pour que le message cite le vrai nom du champ (« email »…).
        assertIdentifierField(identifier, identifierField);
        result = await auth.login({ identifier, password });
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

  return Object.freeze({ authenticate, login, errorHandler });
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
 */
function assertIdentifierField(identifier, field) {
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new InvalidInputError(fieldRequired(field));
  }
  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    throw new InvalidInputError(fieldTooLong(field, MAX_IDENTIFIER_LENGTH));
  }
}

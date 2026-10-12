# Gestion des erreurs

**En bref** : cette page liste les erreurs d'Express AuthKit et explique comment les traiter
dans Express. À la fin, vous saurez reconnaître une erreur par son code, renvoyer une réponse
propre au client et journaliser les échecs de connexion sans risque.

## Reconnaître une erreur : testez le `code`

```javascript
import { AUTH_ERROR_CODES, isAuthKitError } from "@express-authkit/core";

try {
  await auth.login(credentials);
} catch (error) {
  if (isAuthKitError(error) && error.code === AUTH_ERROR_CODES.INVALID_CREDENTIALS) {
    // identifiants refusés
  }
}
```

- `isAuthKitError(error)` indique si l'erreur vient de la bibliothèque.
- `error.code` est un texte stable, comme `"INVALID_CREDENTIALS"`. Il fait partie de l'API
  publique (couvert par le versionnage sémantique).
- Testez toujours le `code`, jamais le message : le message peut évoluer.

Toutes ces erreurs héritent de la classe `AuthKitError`.

## Liste des erreurs

### Erreurs causées par le client (400, 401, 403 et 429)

| `code` | Statut | Quand ? | Message envoyé |
| --- | --- | --- | --- |
| `INVALID_INPUT` | 400 | Entrée mal formée (`login`, `password.hash`) | décrit le champ fautif |
| `INVALID_CREDENTIALS` | 401 | Utilisateur inconnu, mauvais mot de passe, compte désactivé | « Identifiants invalides. » |
| `TOKEN_MISSING` | 401 | Pas de token `Bearer` | « Authentification requise. » |
| `TOKEN_INVALID` | 401 | Token mal formé, falsifié, mauvais `iss`/`aud`/`typ`/algorithme, utilisateur supprimé ou désactivé | « Jeton d’accès invalide. » |
| `TOKEN_EXPIRED` | 401 | Token expiré (signature valide) | « Jeton d’accès expiré. » |
| `ACCESS_DENIED` | 403 | Connecté, mais sans le rôle ou la permission demandé par `authorize()` ([rôles et permissions](roles-et-permissions.md)) | « Accès refusé : vous n’avez pas les droits nécessaires. » |
| `REFRESH_TOKEN_INVALID` | 401 | Refresh token inconnu, expiré, déjà utilisé ou révoqué ([refresh tokens](refresh-tokens.md)) | « Jeton de rafraîchissement invalide ou expiré. Reconnectez-vous. » |
| `TOO_MANY_ATTEMPTS` | 429 | Trop d'échecs sur ce compte, ou trop de tentatives depuis cette adresse IP ([limitation des tentatives](limitation-des-tentatives.md)). En-tête `Retry-After` et propriété `error.retryAfterSeconds`. | « Trop de tentatives de connexion. Réessayez dans 15 minutes. » |

- **400** : la requête est mal formée.
- **401** : la personne n'est pas authentifiée.
- **403** : la personne est authentifiée, mais n'a pas le droit d'accéder à la ressource.
- **429** : trop de tentatives ; il faut attendre avant de réessayer.

### Erreurs côté serveur (à corriger dans votre code ou votre configuration)

| `code` | Quand ? | Ce qui se passe | Message |
| --- | --- | --- | --- |
| `INVALID_CONFIGURATION` | Options absentes ou dangereuses | levée au démarrage | décrit l'option |
| `CONTRACT_VIOLATION` | Repository ou provider non conforme | 500 via `next()` | décrit le contrat |
| `INVALID_PASSWORD_HASH` | Hash stocké illisible (bcrypt, texte brut…) lors d'un appel direct à `auth.password.verify()`. Pendant `auth.login()`, ce cas devient un `INVALID_CREDENTIALS` ordinaire (raison `INVALID_PASSWORD_HASH`, avertissement Node.js) pour ne pas révéler l'existence du compte. | 500 via `next()` | « Le hash de mot de passe enregistré n’est pas au format Argon2id… » |
| `DEPENDENCY_FAILURE` | Votre repository ou un provider a planté (base de données indisponible, bug…) | 500 via `next()` | « L’appel à UserRepository.findById() a échoué… » |

Tous les messages sont en français et expliquent comment corriger le problème.

Noms des classes, dans l'ordre des deux tableaux : `InvalidInputError`,
`InvalidCredentialsError`, `TokenMissingError`, `InvalidTokenError`, `TokenExpiredError`,
`AccessDeniedError`, `InvalidRefreshTokenError`, `TooManyAttemptsError`, `ConfigurationError`, `ContractViolationError`, `InvalidPasswordHashError`,
`DependencyFailureError`.

### Quand votre base de données tombe : `DEPENDENCY_FAILURE`

Si votre repository (ou un provider) lève une erreur, la bibliothèque l'enveloppe dans une
`DependencyFailureError`. Vous obtenez ainsi toujours une erreur avec un `code` stable, et
vous savez **quel appel** a échoué :

```javascript
import { AUTH_ERROR_CODES } from "@express-authkit/core";

app.use((error, req, res, _next) => {
  if (error.code === AUTH_ERROR_CODES.DEPENDENCY_FAILURE) {
    // error.dependency → "UserRepository.findById"
    // error.cause      → l'erreur d'origine (par exemple celle de votre base de données)
    logger.error({ dependency: error.dependency, cause: String(error.cause) });
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erreur interne du serveur." } });
});
```

L'erreur d'origine reste dans `error.cause` : elle n'est **jamais** envoyée au client.

### Journaliser une erreur sans risque

Toutes les erreurs de la bibliothèque se convertissent proprement en JSON :

```javascript
JSON.stringify(error);
// {"name":"InvalidCredentialsError","code":"INVALID_CREDENTIALS","message":"Identifiants invalides."}
```

Cette version ne contient ni la pile d'appels, ni `cause`, ni `reason`.

## Avec Express

### Cas 1 : `authenticate()`, `authorize()`, `login()`, `refresh()` et `logout()` (rien à faire)

Ces middlewares répondent eux-mêmes aux erreurs client (400, 401, 403 et 429). Ils transmettent
les autres erreurs à `next(error)`. Vous n'avez rien à ajouter.

### Cas 2 : vos propres routes, avec `expressAuth.errorHandler()`

Vous appelez `auth.login()` ou `auth.password.hash()` dans **votre** route (connexion
personnalisée, inscription…) ? Ajoutez ce gestionnaire **après** vos routes :

```javascript
app.use(expressAuth.errorHandler());
```

Il transforme `INVALID_INPUT` (400), `INVALID_CREDENTIALS`, `TOKEN_*` et `REFRESH_TOKEN_INVALID` (401), `ACCESS_DENIED`
(403) et `TOO_MANY_ATTEMPTS` (429, avec `Retry-After`) en JSON.
Il gère aussi les erreurs du parseur `express.json()` : un JSON mal formé donne un **400**
(« Le corps de la requête n’est pas un JSON valide. ») et un corps trop gros un **413**,
au lieu de la page d'erreur HTML d'Express.

```json
{ "error": { "code": "INVALID_INPUT", "message": "Le corps de la requête n’est pas un JSON valide." } }
```

Exemple pour un échec de connexion :

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Identifiants invalides." } }
```

Il ajoute l'en-tête `Cache-Control: no-store` (pas de mise en cache), l'en-tête
`WWW-Authenticate` pour les erreurs de token, et `Retry-After` pour les 429. Il passe toutes les autres erreurs au gestionnaire suivant.

### Toujours : un gestionnaire final qui ne dévoile rien

Ajoutez en dernier un gestionnaire qui répond 500 sans détail interne :

```javascript
app.use(expressAuth.errorHandler());

app.use((error, req, res, _next) => {
  // Journalisez sans corps de requête ni en-tête Authorization.
  logger.error({ err: { name: error.name, code: error.code }, method: req.method, path: req.path });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erreur interne du serveur." } });
});
```

> **Ne renvoyez jamais au client** `error.stack`, `error.cause` ou `error.message` d'une erreur
> inconnue. Ils peuvent contenir des noms de serveurs, des requêtes SQL ou des chemins de
> fichiers.
>
> **Ne journalisez jamais** le corps de la requête ni l'en-tête `Authorization` : ils contiennent
> les mots de passe et les tokens.

## Journaliser les échecs de connexion

Quand une connexion échoue, le client reçoit toujours le même message. Mais vous, côté
serveur, pouvez connaître la vraie raison :

| `reason` | Signification |
| --- | --- |
| `USER_NOT_FOUND` | Aucun utilisateur pour cet identifiant / ce `sub`. |
| `INVALID_PASSWORD` | Mot de passe incorrect. |
| `ACCOUNT_DISABLED` | `isActive !== true`. |

Le plus simple est le [journal d'audit](audit.md) : chaque échec y arrive avec sa raison, sans
rien changer à vos routes.

```javascript
const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  audit: (event) => logger.info({ audit: event }, event.type)
});
// {"type":"login.failed","reason":"INVALID_PASSWORD","userId":"42","client":"203.0.113.7",…}
```

Si vous appelez `auth.login()` vous-même, la raison est aussi dans **`error.reason`** (erreurs
`INVALID_CREDENTIALS` et `TOKEN_INVALID`) :

```javascript
try {
  await auth.login({ identifier, password }, { clientKey: clientKeyOf(req) });
} catch (error) {
  if (isAuthKitError(error) && error.code === AUTH_ERROR_CODES.INVALID_CREDENTIALS) {
    logger.warn({ reason: error.reason }); // jamais le mot de passe
  }
  throw error;
}
```

> **Ne renvoyez jamais `error.reason` au client.** Elle dirait à un attaquant si un compte
> existe. Écrivez-la uniquement dans vos journaux.

Pour limiter les fuites, `reason` est **non énumérable** : elle n'apparaît ni dans
`JSON.stringify(error)`, ni dans `{ ...error }`.

## Erreurs au démarrage

`createAuthKit()` et `createExpressAuth()` vérifient votre configuration. En cas de problème,
ils lèvent `ConfigurationError` ou `ContractViolationError`.

Laissez ces erreurs arrêter le processus. Une API qui démarre avec un secret faible ou un
repository incomplet est plus dangereuse qu'une API arrêtée.

Les messages courants sont expliqués dans le [dépannage](depannage.md).

## Pour aller plus loin

### Un format de réponse personnalisé

Vous préférez un autre format, par exemple RFC 9457 *Problem Details* ? Écrivez votre propre
gestionnaire **à la place** de `errorHandler()` :

```javascript
import { AUTH_ERROR_CODES, isAuthKitError } from "@express-authkit/core";

const STATUS_BY_CODE = {
  [AUTH_ERROR_CODES.INVALID_INPUT]: 400,
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [AUTH_ERROR_CODES.TOKEN_MISSING]: 401,
  [AUTH_ERROR_CODES.TOKEN_INVALID]: 401,
  [AUTH_ERROR_CODES.TOKEN_EXPIRED]: 401,
  [AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID]: 401,
  [AUTH_ERROR_CODES.ACCESS_DENIED]: 403,
  [AUTH_ERROR_CODES.TOO_MANY_ATTEMPTS]: 429
};

app.use((error, req, res, next) => {
  const status = isAuthKitError(error) ? STATUS_BY_CODE[error.code] : undefined;
  if (status === undefined) return next(error);
  res
    .status(status)
    .type("application/problem+json")
    .json({ type: "about:blank", title: error.message, status, code: error.code });
});
```

Ce gestionnaire n'ajoute pas les en-têtes `Cache-Control: no-store`, `WWW-Authenticate` et
`Retry-After` (valeur : `error.retryAfterSeconds`).
Ajoutez-les vous-même si vous en avez besoin.

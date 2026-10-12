# Gestion des erreurs

Toutes les erreurs levées par Express AuthKit héritent de `AuthKitError` et possèdent un
**`code` stable** (couvert par le versionnage sémantique). Testez le `code`, pas le message.

```javascript
import { AUTH_ERROR_CODES, isAuthKitError } from "express-authkit";

try {
  await auth.login(credentials);
} catch (error) {
  if (isAuthKitError(error) && error.code === AUTH_ERROR_CODES.INVALID_CREDENTIALS) {
    // identifiants refusés
  }
}
```

## Catalogue

| Classe | `code` | Statut HTTP (adaptateur) | Origine | Message public |
| --- | --- | --- | --- | --- |
| `InvalidInputError` | `INVALID_INPUT` | 400 | Entrée mal formée (`login`, `password.hash`) | décrit le champ fautif |
| `InvalidCredentialsError` | `INVALID_CREDENTIALS` | 401 | Utilisateur inconnu, mauvais mot de passe, compte désactivé | `Invalid credentials.` |
| `TokenMissingError` | `TOKEN_MISSING` | 401 | Pas de jeton `Bearer` | `Authentication required.` |
| `InvalidTokenError` | `TOKEN_INVALID` | 401 | Jeton mal formé, falsifié, mauvais `iss`/`aud`/`typ`/algorithme, utilisateur supprimé ou désactivé | `Invalid access token.` |
| `TokenExpiredError` | `TOKEN_EXPIRED` | 401 | Jeton expiré (signature valide) | `Access token expired.` |
| `ConfigurationError` | `INVALID_CONFIGURATION` | — (démarrage) | Options absentes ou dangereuses | décrit l'option |
| `ContractViolationError` | `CONTRACT_VIOLATION` | 500 via `next()` | Repository ou provider non conforme | décrit le contrat |
| `InvalidPasswordHashError` | `INVALID_PASSWORD_HASH` | 500 via `next()` | Hash stocké illisible (bcrypt, texte brut…) | `Stored password hash is not supported.` |

Les erreurs qui ne viennent pas de la bibliothèque (base de données indisponible, bug
applicatif) sont **propagées telles quelles**.

## Avec Express

### Dans `authenticate()`

Le middleware répond lui-même aux erreurs **client** (401) et transmet les autres à
`next(error)`. Vous n'avez rien à faire pour les routes protégées.

### Dans vos routes : `expressAuth.errorHandler()`

Pour les erreurs levées par `auth.login()` ou `auth.password.hash()` dans vos propres routes,
ajoutez le gestionnaire d'erreurs **après** vos routes :

```javascript
app.use(expressAuth.errorHandler());
```

Il convertit `INVALID_INPUT` (400), `INVALID_CREDENTIALS`, `TOKEN_*` (401) en JSON :

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid credentials." } }
```

avec les en-têtes `Cache-Control: no-store` et, pour les 401, `WWW-Authenticate`.
Toutes les autres erreurs sont transmises au gestionnaire suivant.

### Gestionnaire final recommandé

Ajoutez toujours un dernier gestionnaire qui ne divulgue aucun détail interne :

```javascript
app.use(expressAuth.errorHandler());

app.use((error, req, res, _next) => {
  // Journalisez sans corps de requête ni en-tête Authorization.
  logger.error({ err: { name: error.name, code: error.code }, method: req.method, path: req.path });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
});
```

Ne renvoyez jamais `error.stack`, `error.cause` ou `error.message` d'une erreur inconnue :
ils peuvent contenir des noms d'hôte, des requêtes SQL ou des chemins de fichiers.

### Format de réponse personnalisé

Si vous préférez un autre format (par exemple RFC 9457 *Problem Details*), écrivez votre propre
gestionnaire à la place de `errorHandler()` :

```javascript
import { AUTH_ERROR_CODES, isAuthKitError } from "express-authkit";

const STATUS_BY_CODE = {
  [AUTH_ERROR_CODES.INVALID_INPUT]: 400,
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [AUTH_ERROR_CODES.TOKEN_MISSING]: 401,
  [AUTH_ERROR_CODES.TOKEN_INVALID]: 401,
  [AUTH_ERROR_CODES.TOKEN_EXPIRED]: 401
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

## Journaliser les échecs de connexion

`InvalidCredentialsError` et `InvalidTokenError` portent une propriété **`reason`**
destinée à l'audit côté serveur :

| `reason` | Signification |
| --- | --- |
| `USER_NOT_FOUND` | Aucun utilisateur pour cet identifiant / ce `sub`. |
| `INVALID_PASSWORD` | Mot de passe incorrect. |
| `ACCOUNT_DISABLED` | `isActive !== true`. |

`reason` est **non énumérable** : elle n'apparaît ni dans `JSON.stringify(error)` ni dans
`{ ...error }`, pour éviter qu'elle ne fuite dans une réponse. **Ne l'envoyez jamais au client** :
elle révélerait l'existence des comptes.

```javascript
import { AUTH_ERROR_CODES, isAuthKitError } from "express-authkit";

app.post("/auth/login", async (req, res, next) => {
  try {
    res.json(await auth.login({ identifier: req.body?.identifier, password: req.body?.password }));
  } catch (error) {
    if (isAuthKitError(error) && error.code === AUTH_ERROR_CODES.INVALID_CREDENTIALS) {
      // Ni mot de passe, ni identifiant en clair dans les journaux.
      auditLog.warn({ event: "login.failed", reason: error.reason, ip: req.ip });
    }
    next(error);
  }
});
```

## Erreurs de démarrage

`ConfigurationError` et `ContractViolationError` sont levées par `createAuthKit()` et
`createExpressAuth()`. Laissez-les arrêter le processus : une API qui démarre avec un secret
faible ou un repository incomplet est plus dangereuse qu'une API arrêtée.
Voir le [dépannage](depannage.md) pour les messages courants.

# Référence de l'API publique

L'API publique se compose **uniquement** des exports des deux points d'entrée ci-dessous.
Tout autre fichier est interne (et inaccessible grâce au champ `exports` du `package.json`).

```javascript
import { createAuthKit /* , … */ } from "express-authkit";
import { createExpressAuth } from "express-authkit/express";
```

---

## `express-authkit`

### `createAuthKit(options)` → `AuthKit`

Crée le moteur d'authentification. Lève `ConfigurationError` ou `ContractViolationError`
si les options sont invalides.

| Option | Type | Obligatoire | Description |
| --- | --- | --- | --- |
| `users` | `UserRepository` | oui | Voir [repository](repository-utilisateur.md). |
| `jwt` | `JwtOptions` | oui, sauf si `providers.token` | Voir [configuration JWT](configuration.md#configuration-jwt). |
| `password` | `PasswordOptions` | non | Coûts Argon2id ([configuration](configuration.md#configuration-argon2id)). |
| `providers.password` | `PasswordProvider` | non | Remplace Argon2id. Incompatible avec `password`. |
| `providers.token` | `TokenProvider` | non | Remplace le JWT HMAC. Incompatible avec `jwt`. |

L'objet renvoyé est figé :

#### `auth.login(credentials)` → `Promise<LoginResult>`

| Paramètre | Type |
| --- | --- |
| `credentials.identifier` | `string` (1 à 320 caractères) |
| `credentials.password` | `string` (1 à 1 024 caractères) |

Résultat :

```javascript
{
  accessToken: string,          // JWT signé
  tokenType: "Bearer",
  expiresIn: number,            // secondes
  principal: AuthPrincipal
}
```

Erreurs : `InvalidInputError`, `InvalidCredentialsError`, `InvalidPasswordHashError`,
`ContractViolationError`, erreurs du repository.

#### `auth.verifyAccessToken(token)` → `Promise<AuthPrincipal>`

Vérifie le token, puis que l'utilisateur existe et que `isActive === true`.

Erreurs : `TokenMissingError` (token vide/absent), `InvalidTokenError`, `TokenExpiredError`,
`ContractViolationError`, erreurs du repository.

#### `auth.password.hash(password)` → `Promise<string>`

Renvoie un hash Argon2id (`$argon2id$v=19$…`). Erreur : `InvalidInputError`.

#### `auth.password.verify(password, hash)` → `Promise<boolean>`

Erreurs : `InvalidInputError`, `InvalidPasswordHashError`.

### `AuthPrincipal`

Objet figé :

```javascript
{
  userId: string,     // sub
  tokenId: string,    // jti
  issuedAt: number,   // iat, secondes Unix
  expiresAt: number   // exp, secondes Unix
}
```

### `createArgon2PasswordProvider(options?)` → `PasswordProvider`

Provider par défaut. `options` : `{ memoryCost?, timeCost?, parallelism? }`.

### `createJwtTokenProvider(options)` → `TokenProvider`

Provider par défaut. `options` : mêmes champs que `jwt` dans `createAuthKit()`.

- `issue({ subject })` → `Promise<{ token, tokenId, issuedAt, expiresAt }>`
- `verify(token)` → `Promise<{ subject, tokenId, issuedAt, expiresAt }>`

### Vérification des contrats

| Fonction | Vérifie |
| --- | --- |
| `assertUserRepository(value)` | `findByIdentifier()`, `findById()` |
| `assertPasswordProvider(value)` | `hash()`, `verify()` |
| `assertTokenProvider(value)` | `issue()`, `verify()` |

Chacune lève `ContractViolationError` en nommant les méthodes manquantes.

### Erreurs

| Export | Description |
| --- | --- |
| `AuthKitError` | Classe de base (`name`, `code`, `message`, `cause` éventuelle). |
| `InvalidCredentialsError` | `INVALID_CREDENTIALS` ; propriété non énumérable `reason`. |
| `InvalidInputError` | `INVALID_INPUT`. |
| `TokenMissingError` | `TOKEN_MISSING`. |
| `InvalidTokenError` | `TOKEN_INVALID` ; propriété non énumérable `reason` (utilisateur supprimé/désactivé). |
| `TokenExpiredError` | `TOKEN_EXPIRED`. |
| `ConfigurationError` | `INVALID_CONFIGURATION`. |
| `ContractViolationError` | `CONTRACT_VIOLATION`. |
| `InvalidPasswordHashError` | `INVALID_PASSWORD_HASH`. |
| `AUTH_ERROR_CODES` | Objet figé des codes ci-dessus. |
| `AUTH_FAILURE_REASONS` | `USER_NOT_FOUND`, `INVALID_PASSWORD`, `ACCOUNT_DISABLED`. |
| `isAuthKitError(value)` | `true` si `value` est une `AuthKitError`. |

Détails : [gestion des erreurs](erreurs.md).

### Types JSDoc

Disponibles pour l'autocomplétion dans vos fichiers JavaScript :

```javascript
/** @type {import("express-authkit").UserRepository} */
const userRepository = { /* … */ };

/** @param {import("express-authkit").AuthPrincipal} principal */
function audit(principal) { /* … */ }
```

`AuthKit`, `AuthKitOptions`, `JwtOptions`, `PasswordOptions`, `UserRepository`,
`AuthUserRecord`, `PasswordProvider`, `TokenProvider`, `IssuedToken`,
`VerifiedTokenClaims`, `AuthenticationService`, `LoginCredentials`, `LoginResult`,
`AuthPrincipal`.

---

## `express-authkit/express`

### `createExpressAuth(auth, options?)` → `ExpressAuth`

| Paramètre | Type | Description |
| --- | --- | --- |
| `auth` | `AuthKit` | Moteur créé par `createAuthKit()`. |
| `options.realm` | `string` | Domaine annoncé dans `WWW-Authenticate` (défaut `"api"`, 1 à 64 caractères `A-Z a-z 0-9 espace . _ -`). |

Lève `ContractViolationError` si `auth` n'expose pas `login()` et `verifyAccessToken()`, et
`ConfigurationError` pour une option invalide.

#### `expressAuth.authenticate()` → middleware

- Exige `Authorization: Bearer <token>`.
- Succès : `req.auth = AuthPrincipal`, puis `next()`.
- Échec d'authentification : réponse 401 JSON `{ error: { code, message } }`,
  en-têtes `WWW-Authenticate` et `Cache-Control: no-store`.
- Autre erreur : `next(error)`.

#### `expressAuth.login(options?)` → handler de connexion

| Option | Type | Défaut | Description |
| --- | --- | --- | --- |
| `identifierField` | `string` | `"identifier"` | Champ du corps JSON contenant l'identifiant (`"email"`, `"username"`…). |

- Nécessite un parseur JSON en amont (`express.json()`).
- Succès : `200 { accessToken, tokenType: "Bearer", expiresIn }` avec `Cache-Control: no-store`.
- Échec : 400 (`INVALID_INPUT`) ou 401 (`INVALID_CREDENTIALS`) en JSON.
- Autre erreur : `next(error)`.
- Ce n'est pas une route automatique : vous le montez sur l'URL de votre choix.

#### `expressAuth.errorHandler()` → middleware d'erreur

Convertit `INVALID_INPUT` (400), `INVALID_CREDENTIALS`, `TOKEN_MISSING`, `TOKEN_INVALID`,
`TOKEN_EXPIRED` (401) en JSON. Transmet toute autre erreur avec `next(error)`, ainsi que
toute erreur survenant après l'envoi des en-têtes.

---

## Ligne de commande

```bash
npx express-authkit secret   # affiche un secret JWT aléatoire (48 octets, base64url)
npx express-authkit help     # aide
```

---

## Stabilité

Sont couverts par le versionnage sémantique : les noms et signatures ci-dessus, les codes
d'erreur, la forme de `LoginResult` et de `AuthPrincipal`, le format JSON des réponses
d'erreur de l'adaptateur. Les messages d'erreur peuvent être reformulés dans une version
corrective : basez votre logique sur `code`.

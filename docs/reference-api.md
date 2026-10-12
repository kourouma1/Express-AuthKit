# Référence de l'API publique

**En bref** : cette page liste toutes les fonctions, objets et erreurs que vous pouvez utiliser.
Pour chacun, vous trouverez à quoi il sert, sa signature, un court exemple et les erreurs
possibles. Utilisez-la comme un aide-mémoire quand vous écrivez votre code.

## Les deux points d'entrée

La bibliothèque expose **deux** modules. Tout le reste est interne : le champ `exports` du
`package.json` empêche de l'importer.

```javascript
import { createAuthKit /* , … */ } from "express-authkit";      // le moteur, sans Express
import { createExpressAuth } from "express-authkit/express";      // les middlewares Express
```

Sommaire :

- [`createAuthKit()`](#createauthkitoptions--authkit) et l'objet `auth` qu'il renvoie
- [`AuthPrincipal`](#authprincipal) : l'utilisateur connecté
- [Providers par défaut](#providers-par-défaut)
- [Vérification des contrats](#vérification-des-contrats)
- [Erreurs](#erreurs)
- [`createExpressAuth()`](#createexpressauthauth-options--expressauth) et ses middlewares
- [Ligne de commande](#ligne-de-commande)
- [Stabilité](#stabilité)

---

## Module `express-authkit`

### `createAuthKit(options)` → `AuthKit`

Crée le moteur d'authentification. Vous l'appelez une seule fois, au démarrage.

```javascript
const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" }
});
```

| Option | Type | Obligatoire | Description |
| --- | --- | --- | --- |
| `users` | `UserRepository` | oui | L'objet qui lit vos utilisateurs. Voir [repository](repository-utilisateur.md). |
| `jwt` | `JwtOptions` | oui, sauf si `providers.token` | Réglages des tokens. Voir [configuration JWT](configuration.md#configuration-jwt). |
| `password` | `PasswordOptions` | non | Coûts Argon2id. Voir [configuration](configuration.md#configuration-argon2id). |
| `providers.password` | `PasswordProvider` | non | Remplace Argon2id. Incompatible avec `password`. |
| `providers.token` | `TokenProvider` | non | Remplace le JWT HMAC. Incompatible avec `jwt`. |

Toute autre option est refusée, pour repérer les fautes de frappe.

**Erreurs** (levées au démarrage) :

- `ConfigurationError` : option manquante, inconnue ou non sûre (secret trop faible, etc.).
- `ContractViolationError` : `users` ou un provider n'a pas les méthodes attendues.

L'objet `auth` renvoyé est figé (non modifiable). Il contient les méthodes ci-dessous.

#### `auth.login(credentials)` → `Promise<LoginResult>`

Vérifie un identifiant et un mot de passe, puis renvoie un token d'accès.

```javascript
const result = await auth.login({ identifier: "ada@example.com", password: "…" });
// result.accessToken → à renvoyer au client
```

| Paramètre | Type |
| --- | --- |
| `credentials.identifier` | `string` (1 à 320 caractères) |
| `credentials.password` | `string` (1 à 1 024 caractères) |

Résultat (`LoginResult`) :

```javascript
{
  accessToken: string,          // JWT signé
  tokenType: "Bearer",
  expiresIn: number,            // secondes
  principal: AuthPrincipal
}
```

**Erreurs** :

- `InvalidInputError` : identifiant ou mot de passe absent, vide, pas une chaîne ou trop long.
- `InvalidCredentialsError` : compte inconnu, mauvais mot de passe ou compte désactivé.
  Le message est volontairement le même dans les trois cas.
- `InvalidPasswordHashError` : le hash stocké en base est illisible par le provider.
- `ContractViolationError` : le repository a renvoyé un utilisateur mal formé.
- Les erreurs de votre repository (base indisponible, etc.) sont transmises telles quelles.

#### `auth.verifyAccessToken(token)` → `Promise<AuthPrincipal>`

Vérifie un token. Contrôle ensuite que l'utilisateur existe encore et que
`isActive === true`. Renvoie l'utilisateur connecté.

```javascript
const principal = await auth.verifyAccessToken(token);
console.log(principal.userId);
```

**Erreurs** :

- `TokenMissingError` : token absent ou vide.
- `InvalidTokenError` : token mal formé, trop long, falsifié, mauvais émetteur ou audience,
  utilisateur supprimé ou désactivé.
- `TokenExpiredError` : token correctement signé mais expiré.
- `ContractViolationError` : le provider ou le repository ne respecte pas son contrat.
- Les erreurs de votre repository sont transmises telles quelles.

#### `auth.password.hash(password)` → `Promise<string>`

Hache un mot de passe avant de l'enregistrer (inscription, changement de mot de passe).
Avec le provider par défaut, renvoie un hash Argon2id (`$argon2id$v=19$…`).

```javascript
const passwordHash = await auth.password.hash(req.body.password);
```

**Erreur** : `InvalidInputError` (mot de passe vide, pas une chaîne ou de plus de 1 024 caractères).

#### `auth.password.verify(password, hash)` → `Promise<boolean>`

Vérifie un mot de passe par rapport à un hash. Renvoie `true` s'il correspond.

```javascript
const ok = await auth.password.verify(req.body.currentPassword, user.passwordHash);
```

**Erreurs** : `InvalidInputError`, `InvalidPasswordHashError` (hash illisible ; avec le
provider par défaut, tout hash qui n'est pas Argon2id).

### `AuthPrincipal`

L'utilisateur connecté, tel que le renvoie `verifyAccessToken()` et tel qu'il est placé dans
`req.auth`. C'est un objet figé :

```javascript
{
  userId: string,     // sub
  tokenId: string,    // jti
  issuedAt: number,   // iat, secondes Unix
  expiresAt: number   // exp, secondes Unix
}
```

Il ne contient jamais le hash du mot de passe ni le token brut.

### Providers par défaut

Un **provider** est la brique qui hache les mots de passe ou gère les tokens.
`createAuthKit()` crée ces deux providers pour vous. Vous n'avez besoin de ces fonctions que
pour les utiliser seuls (par exemple dans un script). Voir
[personnaliser les providers](providers-personnalises.md).

#### `createArgon2PasswordProvider(options?)` → `PasswordProvider`

Crée le provider de mots de passe Argon2id.

```javascript
const passwords = createArgon2PasswordProvider({ memoryCost: 65536, timeCost: 3, parallelism: 4 });
```

- `options` : `{ memoryCost?, timeCost?, parallelism? }`. Mêmes règles que l'option
  `password` de `createAuthKit()`.
- Méthodes : `hash(password)` et `verify(password, hash)`, comme `auth.password`.

**Erreurs** : `ConfigurationError` à la création (coûts trop faibles ou option inconnue).
Ensuite, mêmes erreurs que `auth.password.hash()` et `auth.password.verify()`.

#### `createJwtTokenProvider(options)` → `TokenProvider`

Crée le provider de tokens JWT signés en HMAC.

- `options` : mêmes champs que `jwt` dans `createAuthKit()`.
- `issue({ subject })` → `Promise<{ token, tokenId, issuedAt, expiresAt }>`
- `verify(token)` → `Promise<{ subject, tokenId, issuedAt, expiresAt }>`

**Erreurs** :

- `ConfigurationError` à la création (secret faible, émetteur manquant, etc.).
- `issue()` : `InvalidInputError` si `subject` est vide ou dépasse 256 caractères.
- `verify()` : `InvalidTokenError` ou `TokenExpiredError`.

### Vérification des contrats

Un **contrat** est la liste des méthodes qu'un objet doit avoir. Ces fonctions vérifient
qu'un objet a toutes ces méthodes. Elles sont utiles dans vos tests.

```javascript
assertUserRepository(myRepository); // ne fait rien si tout va bien
```

| Fonction | Vérifie la présence de |
| --- | --- |
| `assertUserRepository(value)` | `findByIdentifier()`, `findById()` |
| `assertPasswordProvider(value)` | `hash()`, `verify()` |
| `assertTokenProvider(value)` | `issue()`, `verify()` |

Elles vérifient seulement que les méthodes existent, pas qu'elles fonctionnent.

**Erreur** : `ContractViolationError`, dont le message nomme les méthodes manquantes.

### Erreurs

Toutes les erreurs héritent de `AuthKitError`. Chacune a un `code` stable : basez votre
logique sur ce code, pas sur le message.

```javascript
try {
  await auth.login(credentials);
} catch (error) {
  if (isAuthKitError(error) && error.code === AUTH_ERROR_CODES.INVALID_CREDENTIALS) {
    // mauvais identifiants
  }
}
```

| Export | Code | Quand ? |
| --- | --- | --- |
| `AuthKitError` | — | Classe de base. Propriétés : `name`, `code`, `message`, `cause` éventuelle. |
| `InvalidCredentialsError` | `INVALID_CREDENTIALS` | Connexion refusée. Propriété cachée `reason` (voir ci-dessous). |
| `InvalidInputError` | `INVALID_INPUT` | Donnée de mauvais type, vide ou trop longue. |
| `TokenMissingError` | `TOKEN_MISSING` | Aucun token fourni. |
| `InvalidTokenError` | `TOKEN_INVALID` | Token refusé. Propriété cachée `reason` si l'utilisateur est supprimé ou désactivé. |
| `TokenExpiredError` | `TOKEN_EXPIRED` | Token expiré. |
| `ConfigurationError` | `INVALID_CONFIGURATION` | Configuration manquante ou non sûre, au démarrage. |
| `ContractViolationError` | `CONTRACT_VIOLATION` | Un objet injecté ne respecte pas son contrat. |
| `InvalidPasswordHashError` | `INVALID_PASSWORD_HASH` | Hash stocké illisible. |

Autres exports :

- `AUTH_ERROR_CODES` : objet figé contenant tous les codes ci-dessus.
- `AUTH_FAILURE_REASONS` : les raisons internes `USER_NOT_FOUND`, `INVALID_PASSWORD`,
  `ACCOUNT_DISABLED`.
- `isAuthKitError(value)` : renvoie `true` si `value` est une `AuthKitError`.

> La propriété `reason` est **non énumérable** : elle n'apparaît pas quand l'erreur est
> convertie en JSON. Elle sert uniquement à vos logs côté serveur. Ne l'envoyez jamais au
> client : elle révélerait si un compte existe.

Détails : [gestion des erreurs](erreurs.md).

---

## Module `express-authkit/express`

### `createExpressAuth(auth, options?)` → `ExpressAuth`

Crée les middlewares Express à partir du moteur `auth`.

```javascript
const expressAuth = createExpressAuth(auth);
app.post("/auth/login", express.json(), expressAuth.login());
app.get("/profile", expressAuth.authenticate(), (req, res) => {
  res.json({ userId: req.auth.userId });
});
app.use(expressAuth.errorHandler());
```

| Paramètre | Type | Description |
| --- | --- | --- |
| `auth` | `AuthKit` | Moteur créé par `createAuthKit()`. |
| `options.realm` | `string` | Nom annoncé dans l'en-tête `WWW-Authenticate`. Défaut `"api"`. De 1 à 64 caractères parmi `A-Z a-z 0-9 espace . _ -`. |

**Erreurs** :

- `ContractViolationError` : `auth` n'a pas `login()` et `verifyAccessToken()`.
- `ConfigurationError` : option inconnue ou `realm` invalide.

#### `expressAuth.authenticate()` → middleware

Protège une route : seules les requêtes avec un token valide passent.

- Exige l'en-tête `Authorization: Bearer <token>`.
- Succès : place l'utilisateur dans `req.auth` (un `AuthPrincipal`), puis appelle `next()`.
- Échec d'authentification : répond 401 en JSON `{ error: { code, message } }`, avec les
  en-têtes `WWW-Authenticate` et `Cache-Control: no-store`.
- Autre erreur (base indisponible…) : appelle `next(error)`.

#### `expressAuth.login(options?)` → handler de connexion

Gère une requête de connexion complète : lit le corps, appelle `auth.login()`, répond.

| Option | Type | Défaut | Description |
| --- | --- | --- | --- |
| `identifierField` | `string` | `"identifier"` | Nom du champ JSON qui contient l'identifiant (`"email"`, `"username"`…). |

```javascript
app.post("/auth/login", express.json(), expressAuth.login({ identifierField: "email" }));
```

- Ce n'est pas une route automatique : vous choisissez l'URL.
- Placez un parseur JSON avant lui (`express.json()`).
- Le mot de passe est lu dans le champ `password`.
- Succès : `200 { accessToken, tokenType: "Bearer", expiresIn }`, avec `Cache-Control: no-store`.
- Échec : 400 (`INVALID_INPUT`, par exemple si le corps n'est pas du JSON) ou 401
  (`INVALID_CREDENTIALS`), en JSON.
- Autre erreur : appelle `next(error)`.

**Erreur** : `ConfigurationError` quand vous appelez `login()`, si `identifierField` n'est
pas un nom de champ simple ou si une option est inconnue.

#### `expressAuth.errorHandler()` → middleware d'erreur

Convertit en réponse JSON les erreurs d'authentification levées dans **vos** routes (par
exemple si vous appelez `auth.login()` vous-même).

| Code | Statut HTTP |
| --- | --- |
| `INVALID_INPUT` | 400 |
| `INVALID_CREDENTIALS`, `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED` | 401 |

Toute autre erreur est transmise avec `next(error)`. C'est aussi le cas si la réponse a déjà
commencé à être envoyée.

---

## Ligne de commande

```bash
npx express-authkit secret   # affiche un secret JWT aléatoire (48 octets, base64url)
npx express-authkit help     # aide
```

---

## Stabilité

Ces éléments suivent le **versionnage sémantique** (ils ne changent pas de façon
incompatible sans nouvelle version majeure) :

- les noms et signatures de cette page ;
- les codes d'erreur ;
- la forme de `LoginResult` et de `AuthPrincipal` ;
- le format JSON des réponses d'erreur de l'adaptateur.

Les **messages** d'erreur peuvent être reformulés dans une version corrective. Basez votre
logique sur `code`.

## Pour aller plus loin

### Types JSDoc

Les types sont disponibles pour l'autocomplétion dans vos fichiers JavaScript :

```javascript
/** @type {import("express-authkit").UserRepository} */
const userRepository = { /* … */ };

/** @param {import("express-authkit").AuthPrincipal} principal */
function audit(principal) { /* … */ }
```

Types exportés : `AuthKit`, `AuthKitOptions`, `JwtOptions`, `PasswordOptions`,
`UserRepository`, `AuthUserRecord`, `PasswordProvider`, `TokenProvider`, `IssuedToken`,
`VerifiedTokenClaims`, `AuthenticationService`, `LoginCredentials`, `LoginResult`,
`AuthPrincipal`.

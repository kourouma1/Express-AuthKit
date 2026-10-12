# Connexion des utilisateurs et protection des routes

**En bref** : cette page montre comment connecter un utilisateur et protéger vos routes
privées. À la fin, vous saurez lui remettre un token et réserver une route aux utilisateurs
connectés.

## Le principe

1. L'utilisateur envoie son identifiant et son mot de passe à votre route de connexion.
2. S'ils sont corrects, il reçoit un **token** : une chaîne signée par votre serveur, qui prouve
   qu'il s'est connecté. Ici, c'est un **JWT** (JSON Web Token), un format standard de token.
3. Il joint ce token à chaque requête vers une route protégée.
4. Votre serveur vérifie le token avant d'exécuter la route.

## Étape 1 : la route de connexion

```javascript
import express from "express";
import { createAuthKit } from "@express-authkit/core";
import { createExpressAuth } from "@express-authkit/core/express";

const auth = createAuthKit({ users: userRepository, jwt: { /* … */ } });
const expressAuth = createExpressAuth(auth);

const app = express();
app.post("/auth/login", express.json({ limit: "10kb" }), loginRateLimiters, expressAuth.login());
```

- `express.json()` lit le corps JSON. Placez-le **avant** `expressAuth.login()`.
- `expressAuth.login()` vérifie les identifiants et renvoie le token.
- Vous choisissez l'URL. La bibliothèque ne crée aucune route toute seule.

> **Limitez les tentatives de connexion.** Sans limite, un attaquant peut essayer des milliers
> de mots de passe (attaque par force brute). Pour créer `loginRateLimiters`, voir
> [limitation des tentatives](securite.md#limitation-des-tentatives-de-connexion).

Le client envoie :

```http
POST /auth/login HTTP/1.1
Content-Type: application/json

{ "identifier": "alice@example.com", "password": "…" }
```

Il reçoit (avec l'en-tête `Cache-Control: no-store`, qui interdit la mise en cache du token) :

```json
{ "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9…", "tokenType": "Bearer", "expiresIn": 900 }
```

`expiresIn` est la durée de validité du token, en secondes (ici 15 minutes).

Votre formulaire envoie `email` ou `username` plutôt que `identifier` ? Indiquez-le :

```javascript
app.post("/auth/login", express.json(), expressAuth.login({ identifierField: "email" }));
```

### Erreurs de connexion

`expressAuth.login()` répond lui-même aux erreurs. Pas besoin d'`errorHandler()` pour cette route.

| Situation | Statut | `error.code` |
| --- | --- | --- |
| Corps absent ou non JSON | 400 | `INVALID_INPUT` (le message indique d'envoyer `Content-Type: application/json`) |
| Champ manquant, vide ou trop long | 400 | `INVALID_INPUT` |
| Compte inconnu, mot de passe faux ou compte désactivé | 401 | `INVALID_CREDENTIALS` |
| Erreur inattendue (base indisponible…) | transmise à `next(error)` | — |

Le statut est le code de la réponse HTTP. **400** veut dire « requête mal formée ».
**401** veut dire « non authentifié ».

## Étape 2 : protéger une route

```javascript
app.get("/profile", expressAuth.authenticate(), (req, res) => {
  res.json({ userId: req.auth.userId });
});
```

`expressAuth.authenticate()` est un **middleware** : une fonction qu'Express exécute avant
votre route. Il vérifie le token.

- Token valide : votre route s'exécute et `req.auth` décrit l'utilisateur connecté.
- Token absent ou refusé : il répond **401** à votre place. Votre route ne s'exécute pas.

Le client envoie le token dans l'**en-tête `Authorization`** (une information jointe à la
requête). Le mot **`Bearer`** (« porteur ») annonce le type de token. Il est suivi d'un espace,
puis du token :

```http
GET /profile HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9…
```

### `req.auth`

| Propriété | Description |
| --- | --- |
| `userId` | Identifiant de l'utilisateur (`sub`). |
| `tokenId` | Identifiant unique du token (`jti`), utile pour l'audit. |
| `issuedAt` | Date d'émission (secondes Unix). |
| `expiresAt` | Date d'expiration (secondes Unix). |

« Secondes Unix » : nombre de secondes depuis le 1er janvier 1970.

`req.auth` ne contient ni le token, ni le hash du mot de passe, ni le profil. Chargez le profil
vous-même, en ne sélectionnant que les champs publics :

```javascript
app.get("/me", expressAuth.authenticate(), async (req, res, next) => {
  try {
    const user = await db.users.findPublicProfile(req.auth.userId); // { id, email, name }
    res.json(user);
  } catch (error) {
    next(error);
  }
});
```

### Protéger un groupe de routes

```javascript
const privateRouter = express.Router();
privateRouter.use(expressAuth.authenticate());

privateRouter.get("/orders", listOrders);
privateRouter.post("/orders", createOrder);

app.use("/api", privateRouter);
```

Toutes les routes du routeur exigent un token valide.

### Erreurs sur une route protégée

| Situation | Statut | `error.code` |
| --- | --- | --- |
| Pas d'en-tête, ou schéma autre que `Bearer` | 401 | `TOKEN_MISSING` |
| Token mal formé, falsifié, mauvais émetteur/audience, utilisateur supprimé ou désactivé | 401 | `TOKEN_INVALID` |
| Token expiré | 401 | `TOKEN_EXPIRED` |

```json
{ "error": { "code": "TOKEN_EXPIRED", "message": "Jeton d’accès expiré." } }
```

Quand le client reçoit `TOKEN_EXPIRED`, il redemande une connexion.

> Pour réserver une route à certains utilisateurs (administrateurs, permissions…), utilisez
> `expressAuth.authorize()` : voir [rôles et permissions](roles-et-permissions.md).

## Étape 3 : côté client (navigateur, mobile)

```javascript
const response = await fetch("https://api.example.com/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier, password })
});
const { accessToken } = await response.json();

const profile = await fetch("https://api.example.com/profile", {
  headers: { authorization: `Bearer ${accessToken}` }
});
```

> **Où garder le token ?** En mémoire (une variable) plutôt que dans `localStorage` quand c'est
> possible : en cas de faille XSS (script malveillant injecté dans la page), `localStorage` est
> lisible. Ne mettez **jamais** le token dans une URL.

## Pour aller plus loin

### Votre propre route de connexion avec `auth.login()`

Pour un autre format de réponse (ajouter le profil, journaliser l'échec…), appelez
`auth.login()` vous-même. Ajoutez alors `expressAuth.errorHandler()` **après** vos routes :

```javascript
app.post("/auth/login", express.json(), loginRateLimiters, async (req, res, next) => {
  try {
    const result = await auth.login({
      identifier: req.body?.email,
      password: req.body?.password
    });
    res.set("Cache-Control", "no-store");
    res.json({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: await db.users.findPublicProfile(result.principal.userId)
    });
  } catch (error) {
    next(error); // traité par expressAuth.errorHandler()
  }
});

app.use(expressAuth.errorHandler());
```

### Ce que fait `login()`

1. Valide l'entrée : `identifier` et `password` doivent être des chaînes non vides
   (au plus 320 et 1 024 caractères). Sinon : `InvalidInputError` → **400**.
2. Appelle `users.findByIdentifier(identifier)`.
3. Utilisateur inconnu : vérifie quand même le mot de passe contre un hash factice (même durée
   qu'un vrai compte), puis lève `InvalidCredentialsError` → **401**.
4. Mot de passe faux : `InvalidCredentialsError` → **401**.
5. `isActive !== true` : `InvalidCredentialsError` → **401**.
6. Émet un JWT d'accès et renvoie :

```javascript
{
  accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9…",
  tokenType: "Bearer",
  expiresIn: 900,
  principal: { userId: "42", tokenId: "…", issuedAt: 1760000000, expiresAt: 1760000900 }
}
```

Les cas 3, 4 et 5 donnent **exactement la même erreur publique** (`INVALID_CREDENTIALS`,
« Identifiants invalides. »). Un attaquant ne peut donc pas savoir si un compte existe.
La vraie raison est disponible côté serveur dans `error.reason`
(voir [erreurs](erreurs.md#journaliser-les-échecs-de-connexion)).

### Ce que fait `authenticate()`

1. Lit `Authorization: Bearer <token>` (`Bearer` accepte majuscules et minuscules).
2. Appelle `auth.verifyAccessToken(token)`. Elle vérifie la signature, l'algorithme, `typ`,
   `iss`, `aud`, `exp`, `iat`, `sub` et `jti`, **puis** que l'utilisateur existe toujours et
   que `isActive === true`.
3. Succès : place un objet figé dans `req.auth` et appelle `next()`.
4. Échec d'authentification : répond **401** (JSON + en-tête `WWW-Authenticate`).
5. Erreur inattendue (base de données indisponible…) : appelle `next(error)`.

L'en-tête standard `WWW-Authenticate` indique au client comment s'authentifier. Il vaut
`Bearer realm="api"` pour `TOKEN_MISSING`, et `Bearer realm="api", error="invalid_token"` pour
`TOKEN_INVALID` et `TOKEN_EXPIRED`. Le domaine (`realm`) se personnalise :
`createExpressAuth(auth, { realm: "my-api" })`.

### Express 4 et 5

Les middlewares sont de simples fonctions `(req, res, next)` qui gèrent leurs propres erreurs
asynchrones. Ils fonctionnent avec Express 4.21+ et Express 5. Avec Express 4, entourez vos
propres gestionnaires `async` d'un `try/catch` + `next(error)`, comme dans les exemples
ci-dessus.

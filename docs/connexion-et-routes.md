# Connexion des utilisateurs et protection des routes

## Connexion : `auth.login()`

Express AuthKit ne crée pas de route automatiquement : vous gardez le contrôle de l'URL, du
format de la requête et de la réponse.

```javascript
import express from "express";
import { createAuthKit } from "express-authkit";
import { createExpressAuth } from "express-authkit/express";

const auth = createAuthKit({ users: userRepository, jwt: { /* … */ } });
const expressAuth = createExpressAuth(auth);

const app = express();
app.use(express.json({ limit: "10kb" }));

app.post("/auth/login", loginRateLimiters, async (req, res, next) => {
  try {
    const result = await auth.login({
      identifier: req.body?.identifier,
      password: req.body?.password
    });
    res.set("Cache-Control", "no-store");
    res.json({
      accessToken: result.accessToken,
      tokenType: result.tokenType, // "Bearer"
      expiresIn: result.expiresIn  // en secondes
    });
  } catch (error) {
    next(error); // traité par expressAuth.errorHandler()
  }
});

app.use(expressAuth.errorHandler());
```

> `loginRateLimiters` : voir [limitation des tentatives](securite.md#limitation-des-tentatives-de-connexion).
> Sans limitation, une route de connexion est exposée aux attaques par force brute.

### Ce que fait `login()`

1. Valide l'entrée : `identifier` et `password` doivent être des chaînes non vides
   (≤ 320 et ≤ 1 024 caractères). Sinon : `InvalidInputError` → **400**.
2. Appelle `users.findByIdentifier(identifier)`.
3. Utilisateur inconnu : vérifie quand même le mot de passe contre un hash factice
   (même coût qu'un vrai hash), puis lève `InvalidCredentialsError` → **401**.
4. Vérifie le mot de passe ; s'il est faux : `InvalidCredentialsError` → **401**.
5. Si `isActive !== true` : `InvalidCredentialsError` → **401**.
6. Émet un JWT d'accès et renvoie :

```javascript
{
  accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9…",
  tokenType: "Bearer",
  expiresIn: 900,
  principal: { userId: "42", tokenId: "…", issuedAt: 1760000000, expiresAt: 1760000900 }
}
```

Les cas 3, 4 et 5 produisent **exactement la même erreur publique**
(`INVALID_CREDENTIALS`, « Invalid credentials. ») : un attaquant ne peut pas savoir si un
compte existe. La raison réelle est disponible côté serveur dans `error.reason`
(voir [erreurs](erreurs.md#journaliser-les-échecs-de-connexion)).

## Protéger des routes : `expressAuth.authenticate()`

```javascript
app.get("/profile", expressAuth.authenticate(), (req, res) => {
  res.json({ userId: req.auth.userId });
});
```

Le client envoie le token dans l'en-tête `Authorization` :

```http
GET /profile HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9…
```

### Ce que fait le middleware

1. Lit `Authorization: Bearer <token>` (le schéma `Bearer` est insensible à la casse).
2. Appelle `auth.verifyAccessToken(token)`, qui vérifie la signature, l'algorithme,
   `typ`, `iss`, `aud`, `exp`, `iat`, `sub` et `jti`, **puis** que l'utilisateur existe
   toujours et que `isActive === true`.
3. En cas de succès, place un objet figé dans `req.auth` et appelle `next()`.
4. En cas d'échec d'authentification, répond directement en **401** (JSON + `WWW-Authenticate`).
5. En cas d'erreur inattendue (base de données indisponible…), appelle `next(error)`.

### `req.auth`

| Propriété | Description |
| --- | --- |
| `userId` | Identifiant de l'utilisateur (`sub`). |
| `tokenId` | Identifiant unique du token (`jti`), utile pour l'audit. |
| `issuedAt` | Date d'émission (secondes Unix). |
| `expiresAt` | Date d'expiration (secondes Unix). |

`req.auth` ne contient ni le token, ni le hash, ni les données du profil. Chargez le profil
vous-même si nécessaire, en sélectionnant les champs publics :

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

### Réponses en cas d'échec

| Situation | Statut | `error.code` | `WWW-Authenticate` |
| --- | --- | --- | --- |
| Pas d'en-tête, ou schéma autre que `Bearer` | 401 | `TOKEN_MISSING` | `Bearer realm="api"` |
| Token mal formé, falsifié, mauvais émetteur/audience, utilisateur supprimé ou désactivé | 401 | `TOKEN_INVALID` | `Bearer realm="api", error="invalid_token"` |
| Token expiré | 401 | `TOKEN_EXPIRED` | `Bearer realm="api", error="invalid_token"` |

```json
{ "error": { "code": "TOKEN_EXPIRED", "message": "Access token expired." } }
```

Un client peut utiliser `TOKEN_EXPIRED` pour redemander une connexion. Le domaine (`realm`)
se personnalise : `createExpressAuth(auth, { realm: "my-api" })`.

## Compatibilité Express 4 et 5

Les middlewares sont de simples fonctions `(req, res, next)` qui gèrent leurs propres erreurs
asynchrones : ils fonctionnent avec Express 4.21+ et Express 5. Dans Express 4, pensez à
entourer vos propres gestionnaires asynchrones d'un `try/catch` + `next(error)`, comme dans
les exemples ci-dessus.

## Côté client (navigateur, mobile)

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

Conservez le token en mémoire plutôt que dans `localStorage` lorsque c'est possible
(exposition en cas de faille XSS), et ne l'ajoutez jamais à une URL.

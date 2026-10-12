# Utiliser Express AuthKit avec TypeScript

**En bref** : la bibliothèque est écrite en JavaScript et livrée avec ses types TypeScript.
**Toute la documentation est écrite en JavaScript** ; cette page est la seule à montrer du
TypeScript. Elle explique comment démarrer un projet TypeScript et quelles sont les
**trois petites différences** quand vous reprenez un exemple JavaScript.

## JavaScript ou TypeScript : comment choisir sa page

| Vous écrivez… | Fichiers | Suivez |
| --- | --- | --- |
| **JavaScript** | `server.js` | Le [README](../README.md) et toute la documentation, tels quels. Cette page est facultative. |
| **TypeScript** | `src/server.ts` | Cette page pour la mise en place, puis le reste de la documentation en appliquant les [trois différences](#reprendre-un-exemple-javascript--les-trois-différences). |

> **Ne mélangez pas les deux dans un même fichier.** Un fichier `.js` ne doit pas contenir de
> syntaxe TypeScript (`: string`, `interface`, `!`, `import { type … }`) : Node.js refuserait
> de le lancer.

## Démarrage en cinq minutes (TypeScript)

**Étape 1 — Créez le projet**

```bash
mkdir mon-api-ts && cd mon-api-ts
npm init -y
npm pkg set type=module
npm install express-authkit express
npm install --save-dev typescript @types/express @types/node
npm pkg set scripts.build="tsc" scripts.start="node --env-file=.env dist/server.js"
echo "AUTH_SECRET=$(npx express-authkit secret)" > .env
```

**Étape 2 — Créez `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`"module": "nodenext"` est le réglage important : il correspond aux modules ES utilisés par
Node.js et par la bibliothèque.

**Étape 3 — Créez `src/server.ts`**

```typescript
import express from "express";
import { createAuthKit, type UserRepository } from "express-authkit";
import { createExpressAuth } from "express-authkit/express";

// 1. Où trouver vos utilisateurs : ici une simple liste, pour la démonstration.
//    En production, interrogez votre base (voir docs/repository-utilisateur.md).
interface User {
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  roles: string[];
}

const users: User[] = [];

const userRepository: UserRepository = {
  findByIdentifier: async (email) => users.find((user) => user.email === email.toLowerCase()) ?? null,
  findById: async (id) => users.find((user) => user.id === id) ?? null
};

// 2. Le moteur d'authentification (la configuration est vérifiée immédiatement).
const auth = createAuthKit({
  users: userRepository,
  jwt: {
    secret: process.env.AUTH_SECRET,
    issuer: "my-api",
    audience: "my-client",
    expiresInSeconds: 900
  }
});
const expressAuth = createExpressAuth(auth);

// 3. Un utilisateur de démonstration (ne codez jamais de vrai mot de passe en dur).
users.push({
  id: "1",
  email: "alice@example.com",
  passwordHash: await auth.password.hash("example-password"),
  isActive: true,
  roles: ["admin"]
});

// 4. L'application : connexion, route protégée, route réservée aux administrateurs.
const app = express();

app.post("/login", express.json(), expressAuth.login({ identifierField: "email" }));

app.get("/profile", expressAuth.authenticate(), (req, res) => {
  // authenticate() garantit que req.auth existe : le « ! » le dit à TypeScript.
  res.json({ userId: req.auth!.userId });
});

app.get("/admin", expressAuth.authorize("admin"), (req, res) => {
  res.json({ roles: req.auth!.roles });
});

// 5. Des réponses JSON claires, en français, si le client envoie un JSON invalide.
app.use(expressAuth.errorHandler());

app.listen(3000, () => console.log("API sur http://localhost:3000"));
```

**Étape 4 — Compilez et lancez**

```bash
npm run build   # compile src/server.ts vers dist/server.js
npm start
```

Testez avec les mêmes commandes `curl` que dans le [README](../README.md#démarrage-en-cinq-minutes)
(le champ s'appelle `email` ici aussi).

> Pour un essai rapide, Node.js 24 sait aussi lancer un fichier TypeScript directement :
> `node --env-file=.env src/server.ts`. Cela fonctionne pour un fichier seul ; pour un vrai
> projet, gardez la compilation (`npm run build`).

## Reprendre un exemple JavaScript : les trois différences

Les exemples de la documentation fonctionnent en TypeScript. Seuls trois points changent :

| # | En JavaScript | En TypeScript | Pourquoi |
| --- | --- | --- | --- |
| 1 | `req.auth.userId` | `req.auth!.userId` | TypeScript ne sait pas que `authenticate()` ou `authorize()` a rempli `req.auth`. Le `!` le lui dit. N'utilisez-le **que** dans une route protégée. |
| 2 | `const userRepository = { … }` | `const userRepository: UserRepository = { … }` | Le type donne l'autocomplétion et vérifie les paramètres (`email`, `id`). Importez-le avec `import { type UserRepository } from "express-authkit"`. |
| 3 | `import { db } from "./db.js"` | `import { db } from "./db.js"` (**même chose**) | Pour vos propres fichiers, gardez l'extension `.js` dans l'import, même si le fichier s'appelle `db.ts` : c'est la règle de `"module": "nodenext"`. |

Ce qui **ne change pas** :

- les imports de la bibliothèque : `import { createAuthKit } from "express-authkit"` et
  `import { createExpressAuth } from "express-authkit/express"` ;
- `secret: process.env.AUTH_SECRET` fonctionne tel quel, sans `!` : si la variable manque,
  `createAuthKit()` s'arrête avec un message clair ;
- les options, les noms de fonctions et les réponses HTTP.

## Ce que les types vous apportent

- Les options de `createAuthKit()` sont vérifiées dans l'éditeur : une faute de frappe ou un
  mauvais type (`expiresInSeconds: "15m"` au lieu de `900`) est signalé avant même de lancer
  l'application.
- `req.auth` est typé : `req.auth!.userId` est un `string`, `req.auth!.roles` une liste de textes.
- Dans `authorize({ check: (user, req) => … })`, `user` et `req` sont typés.
- Tous les types publics sont exportés : `UserRepository`, `RefreshTokenStore`, `LoginResult`,
  `AuthPrincipal`, `AuthKitOptions`, `AuthorizationRequirement`…

## Pour aller plus loin

### Vérifier un projet JavaScript avec les types

Sans passer à TypeScript, vous pouvez profiter des mêmes vérifications dans VS Code : ajoutez
`// @ts-check` en première ligne d'un fichier `.js`, et typez vos objets avec un commentaire
JSDoc. Ce commentaire est ignoré par Node.js : le fichier reste du JavaScript.

```javascript
// @ts-check
/** @type {import("express-authkit").UserRepository} */
const userRepository = {
  async findByIdentifier(email) { /* … */ },
  async findById(id) { /* … */ }
};
```

Avec `// @ts-check`, la différence n°1 s'applique aussi : écrivez `req.auth?.userId`, ou
vérifiez que `req.auth` existe.

### Comment les types sont produits

- Les types sont **générés automatiquement** à partir de la documentation JSDoc du code source
  (`npm run build:types`). Aucun fichier TypeScript n'est écrit à la main, à une exception près :
  la déclaration de `req.auth`, ajoutée par le script de génération.
- Le test du package vérifie les types comme le ferait un utilisateur, en mode strict, et
  compile puis exécute le démarrage rapide de cette page.
- `req.auth` est déclaré comme facultatif car il n'existe que derrière `authenticate()` ou
  `authorize()`. Le déclarer toujours présent serait plus court, mais faux sur les routes
  publiques.

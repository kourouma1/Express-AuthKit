# Utiliser Express AuthKit avec TypeScript

**En bref** : la bibliothèque est écrite en JavaScript, mais elle est livrée avec ses types
TypeScript. Vous avez l'autocomplétion et la vérification des types dans un projet TypeScript,
et aussi dans un projet JavaScript ouvert dans VS Code.

## Installation

Rien de plus à installer pour la bibliothèque elle-même. Pour Express, ajoutez ses types si ce
n'est pas déjà fait :

```bash
npm install --save-dev @types/express
```

## Ce que vous obtenez

- Les options de `createAuthKit()` sont vérifiées : une faute de frappe ou un mauvais type
  (`expiresInSeconds: "15m"` au lieu de `900`) est signalé **dans l'éditeur**, avant même de
  lancer l'application.
- `req.auth` est typé dans vos routes Express : `req.auth?.userId` est un `string`, et
  `req.auth?.roles` une liste de textes.
- Dans `authorize({ check: (user, req) => … })`, `user` et `req` (la requête Express) sont typés.
- Tous les types publics sont exportés : `UserRepository`, `RefreshTokenStore`, `LoginResult`,
  `AuthPrincipal`, `AuthKitOptions`…

```typescript
import express from "express";
import { createAuthKit, type UserRepository } from "express-authkit";
import { createExpressAuth } from "express-authkit/express";

const users: UserRepository = {
  async findByIdentifier(email) {
    return db.users.findByEmail(email); // { id, passwordHash, isActive } ou null
  },
  async findById(id) {
    return db.users.findById(id);
  }
};

const auth = createAuthKit({
  users,
  jwt: { secret: process.env.AUTH_SECRET!, issuer: "my-api", audience: "my-client" }
});
const expressAuth = createExpressAuth(auth);

const app = express();
app.get("/profile", expressAuth.authenticate(), (req, res) => {
  res.json({ userId: req.auth?.userId }); // string | undefined
});
```

> `db` représente votre couche d'accès aux données.

## En JavaScript

Dans un fichier `.js`, ajoutez `// @ts-check` en première ligne : VS Code vérifie alors vos appels
avec les mêmes types. Pour typer un objet, utilisez JSDoc :

```javascript
// @ts-check
/** @type {import("express-authkit").UserRepository} */
const users = {
  async findByIdentifier(email) { /* … */ },
  async findById(id) { /* … */ }
};
```

## Pour aller plus loin

- Les types sont **générés automatiquement** à partir de la documentation JSDoc du code source
  (`npm run build:types`). Aucun fichier TypeScript n'est écrit à la main, à une exception près :
  la déclaration de `req.auth`, ajoutée par le script de génération.
- Le test du package vérifie les types comme le ferait un utilisateur : un fichier exemple est
  contrôlé par TypeScript en mode strict, y compris des erreurs volontaires qui **doivent** être
  détectées.
- `req.auth` est déclaré comme facultatif (`req.auth?.userId`), car TypeScript ne peut pas savoir
  si `authenticate()` a été placé avant votre route.

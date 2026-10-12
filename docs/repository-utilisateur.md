# Créer le repository utilisateur

Express AuthKit ne contient aucune base de données. Vous lui fournissez un objet
`users` qui sait retrouver un utilisateur : c'est le **contrat `UserRepository`**.

## Le contrat

```javascript
/**
 * @type {import("express-authkit").UserRepository}
 */
const userRepository = {
  // Appelée par auth.login() avec l'identifiant saisi (e-mail, nom d'utilisateur…).
  async findByIdentifier(identifier) { /* … */ },

  // Appelée par auth.verifyAccessToken() avec le `sub` du token (= user.id).
  async findById(id) { /* … */ }
};
```

Les deux méthodes doivent renvoyer une promesse résolue avec :

- un **enregistrement** `{ id, passwordHash, isActive }` si l'utilisateur existe ;
- `null` (ou `undefined`) sinon — **sans lever d'erreur**.

| Champ | Type | Rôle |
| --- | --- | --- |
| `id` | `string` non vide | Identifiant stable et non secret. Devient le `sub` du JWT et `req.auth.userId`. Convertissez les identifiants numériques ou `ObjectId` en chaîne. |
| `passwordHash` | `string` | Hash produit par `auth.password.hash()`. |
| `isActive` | `boolean` | Doit valoir **exactement** `true` pour autoriser l'accès. |

Les champs supplémentaires (e-mail, nom…) sont acceptés et ignorés : ils ne sont jamais
copiés dans le token ni dans `req.auth`.

### Règles importantes

- **Normalisez l'identifiant** (`trim()`, minuscules pour un e-mail) dans `findByIdentifier`,
  et utilisez la même normalisation à l'inscription.
- **Ne levez une erreur que pour un problème d'infrastructure** (base indisponible…).
  Elle est alors propagée telle quelle : avec l'adaptateur Express, elle arrive dans votre
  gestionnaire d'erreurs (réponse 500).
- Un enregistrement mal formé (`id` numérique, `isActive` absent…) lève une
  `ContractViolationError` : c'est une erreur de programmation à corriger.
- `identifier` et `id` sont **toujours des chaînes** quand ils arrivent dans le repository :
  le moteur refuse en amont tout autre type (protection contre l'injection d'opérateurs NoSQL
  comme `{ "$ne": null }`). Utilisez tout de même des requêtes paramétrées.
- Le contrat est vérifié **au démarrage** : une méthode manquante lève
  `ContractViolationError: UserRepository must implement: findById().`

### Mettre en correspondance un modèle existant

Si vos colonnes portent d'autres noms (`password`, `enabled`, `status`…), faites la
conversion dans le repository :

```javascript
function toAuthRecord(row) {
  if (!row) return null;
  return {
    id: String(row.user_id),
    passwordHash: row.password_digest,
    isActive: row.status === "active" && row.deleted_at === null
  };
}
```

## Exemple en mémoire (tests, démonstration)

```javascript
export function createInMemoryUserRepository() {
  const usersById = new Map();

  return {
    add(user) {
      usersById.set(user.id, { ...user, email: user.email.trim().toLowerCase() });
    },
    async findByIdentifier(identifier) {
      const email = identifier.trim().toLowerCase();
      for (const user of usersById.values()) {
        if (user.email === email) return user;
      }
      return null;
    },
    async findById(id) {
      return usersById.get(id) ?? null;
    }
  };
}
```

Une version plus complète, utilisée par l'application d'exemple et ses tests, se trouve dans
[examples/basic-express/src/in-memory-user-repository.js](../examples/basic-express/src/in-memory-user-repository.js).

## Exemples avec différentes bases de données

> Ces exemples montrent l'adaptation au contrat. Ils supposent un schéma minimal
> (`id`, `email` unique, `password_hash`, `is_active`) : adaptez les noms à votre schéma.
> Ils ne font pas partie de la suite de tests automatisés du projet, qui n'utilise aucune
> base de données réelle.

### PostgreSQL avec `pg`

```sql
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true
);
```

```javascript
// user-repository.pg.js
import pg from "pg";

const AUTH_COLUMNS = 'id::text AS "id", password_hash AS "passwordHash", is_active AS "isActive"';

/**
 * @param {pg.Pool} pool
 * @returns {import("express-authkit").UserRepository}
 */
export function createPgUserRepository(pool) {
  return {
    async findByIdentifier(identifier) {
      const { rows } = await pool.query(`SELECT ${AUTH_COLUMNS} FROM users WHERE email = $1`, [
        identifier.trim().toLowerCase()
      ]);
      return rows[0] ?? null;
    },
    async findById(id) {
      const { rows } = await pool.query(`SELECT ${AUTH_COLUMNS} FROM users WHERE id = $1`, [id]);
      return rows[0] ?? null;
    }
  };
}

// Utilisation
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const auth = createAuthKit({ users: createPgUserRepository(pool), jwt: { /* … */ } });
```

Les paramètres `$1` protègent contre l'injection SQL ; ne concaténez jamais l'identifiant
dans la requête.

### Prisma

```prisma
model User {
  id           String  @id @default(uuid())
  email        String  @unique
  passwordHash String
  isActive     Boolean @default(true)
}
```

```javascript
// user-repository.prisma.js
const AUTH_FIELDS = { id: true, passwordHash: true, isActive: true };

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @returns {import("express-authkit").UserRepository}
 */
export function createPrismaUserRepository(prisma) {
  return {
    findByIdentifier(identifier) {
      return prisma.user.findUnique({
        where: { email: identifier.trim().toLowerCase() },
        select: AUTH_FIELDS
      });
    },
    findById(id) {
      return prisma.user.findUnique({ where: { id }, select: AUTH_FIELDS });
    }
  };
}
```

`select` limite la lecture aux champs utiles. Si votre `id` est un entier (`Int @id`),
convertissez-le : `id: String(user.id)` à la lecture et `Number(id)` dans `findById`.

### MongoDB avec Mongoose

```javascript
// user-repository.mongoose.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  isActive: { type: Boolean, default: true }
});
export const User = mongoose.model("User", userSchema);

function toAuthRecord(doc) {
  return doc ? { id: doc._id.toString(), passwordHash: doc.passwordHash, isActive: doc.isActive } : null;
}

/** @returns {import("express-authkit").UserRepository} */
export function createMongooseUserRepository() {
  return {
    async findByIdentifier(identifier) {
      const doc = await User.findOne({ email: identifier.trim().toLowerCase() })
        .select("+passwordHash isActive")
        .lean();
      return toAuthRecord(doc);
    },
    async findById(id) {
      // Un identifiant mal formé n'est pas une erreur d'infrastructure : on renvoie null.
      if (!mongoose.isValidObjectId(id)) return null;
      const doc = await User.findById(id).select("+passwordHash isActive").lean();
      return toAuthRecord(doc);
    }
  };
}
```

`select: false` sur `passwordHash` évite que le hash ne soit renvoyé par les autres requêtes
de l'application ; le repository le demande explicitement avec `+passwordHash`.

### API distante (microservice utilisateurs)

```javascript
/** @returns {import("express-authkit").UserRepository} */
export function createHttpUserRepository(baseUrl, serviceToken) {
  async function fetchUser(path) {
    const response = await fetch(new URL(path, baseUrl), {
      headers: { authorization: `Bearer ${serviceToken}` },
      signal: AbortSignal.timeout(2000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`User service responded with ${response.status}`);
    const user = await response.json();
    return { id: String(user.id), passwordHash: user.passwordHash, isActive: user.active === true };
  }

  return {
    findByIdentifier: (identifier) => fetchUser(`/internal/users/by-email/${encodeURIComponent(identifier.trim().toLowerCase())}`),
    findById: (id) => fetchUser(`/internal/users/${encodeURIComponent(id)}`)
  };
}
```

## Tester son repository

Le contrat peut être vérifié sans démarrer d'application :

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertUserRepository } from "express-authkit";

import { createPgUserRepository } from "./user-repository.pg.js";

// Faux pool : aucune base de données n'est nécessaire pour ces tests.
const emptyPool = { query: async () => ({ rows: [] }) };

test("respecte le contrat UserRepository", () => {
  assert.doesNotThrow(() => assertUserRepository(createPgUserRepository(emptyPool)));
});

test("renvoie null pour un utilisateur inconnu", async () => {
  const repository = createPgUserRepository(emptyPool);
  assert.equal(await repository.findByIdentifier("nobody@example.com"), null);
});
```

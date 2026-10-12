# Créer le repository utilisateur

> **En bref** — Express AuthKit ne contient aucune base de données. Vous lui donnez un petit
> objet, le **repository utilisateur**, qui sait retrouver vos utilisateurs. Après cette page,
> vous saurez écrire ce repository pour votre base (PostgreSQL, Prisma, MongoDB…) et le tester.

## Le contrat

Un **repository** est simplement un objet qui fait le lien entre la bibliothèque et votre
base de données. Il doit avoir deux méthodes :

```javascript
/**
 * @type {import("@kourouma/express-authkit").UserRepository}
 */
const userRepository = {
  // Appelée par auth.login() avec l'identifiant saisi (e-mail, nom d'utilisateur…).
  async findByIdentifier(identifier) { /* … */ },

  // Appelée par auth.verifyAccessToken() avec le `sub` du token (= user.id).
  async findById(id) { /* … */ }
};
```

- `findByIdentifier(identifier)` est appelée à la **connexion**, avec l'e-mail ou le nom saisi.
- `findById(id)` est appelée à **chaque requête authentifiée**, avec l'identifiant lu dans le token.

Chaque méthode renvoie une promesse qui donne :

- `{ id, passwordHash, isActive }` si l'utilisateur existe ;
- `null` (ou `undefined`) sinon. **Ne levez pas d'erreur** dans ce cas.

Les trois champs attendus :

- **`id`** : identifiant stable et non secret. Chaîne, entier, `BigInt` ou `ObjectId` MongoDB.
  Il est **converti automatiquement en chaîne**. Il devient le `sub` du token et `req.auth.userId`.
- **`passwordHash`** : le hash produit par `auth.password.hash()` (voir [mots de passe](mots-de-passe.md)).
- **`isActive`** : un booléen. L'accès n'est autorisé que s'il vaut **exactement** `true`.

Deux champs facultatifs, pour les [rôles et permissions](roles-et-permissions.md) :

- **`roles`** : liste de rôles, par exemple `["admin"]`.
- **`permissions`** : liste de permissions, par exemple `["orders:write"]`.

Ils sont relus à chaque requête et copiés dans `req.auth.roles` et `req.auth.permissions`.

Vous pouvez renvoyer d'autres champs (e-mail, nom…). Ils sont ignorés : ils ne sont jamais
copiés dans le token ni dans `req.auth`.

### Règles importantes

1. **`findById()` reçoit toujours une chaîne.** Elle reçoit `"42"`, pas `42`. Si votre
   identifiant est un nombre, convertissez-le dans la requête.
2. **`findById()` doit renvoyer le même `id`.** Une fois converti en chaîne, l'`id` renvoyé
   doit être égal à celui reçu. Sinon, la bibliothèque lève une `ContractViolationError`.
3. **Normalisez l'identifiant** dans `findByIdentifier` : `trim()` et minuscules pour un e-mail.
   Utilisez exactement la même normalisation à l'inscription.
4. **Ne levez une erreur que pour un problème technique** (base indisponible…). La bibliothèque
   l'enveloppe dans une `DependencyFailureError` (code `DEPENDENCY_FAILURE`). L'erreur
   d'origine reste dans `error.cause`. Avec l'adaptateur Express, elle arrive dans votre
   gestionnaire d'erreurs (réponse 500), sans jamais être montrée au client.
5. **Pas de compte désactivable ?** Renvoyez simplement `isActive: true`.
6. **Utilisez des requêtes paramétrées.** La bibliothèque garantit déjà que `identifier` et
   `id` sont des chaînes. Elle bloque ainsi les injections d'opérateurs NoSQL comme
   `{ "$ne": null }`. Les requêtes paramétrées restent quand même indispensables.

Deux erreurs vous aident à corriger un repository mal écrit :

- Au **démarrage**, une méthode manquante lève
  `ContractViolationError: UserRepository doit implémenter la méthode findById().`
- À l'**exécution**, un enregistrement mal formé (`passwordHash` oublié dans la requête,
  `isActive` absent…) lève une `ContractViolationError`. Son message indique comment corriger.

### Mettre en correspondance un modèle existant

Vos colonnes portent d'autres noms (`password`, `enabled`, `status`…) ? Faites la conversion
dans le repository :

```javascript
function toAuthRecord(row) {
  if (!row) return null;
  return {
    id: row.user_id, // entier ou chaîne : converti automatiquement
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
      // findById() reçoit toujours une chaîne : on range donc les utilisateurs par String(id).
      usersById.set(String(user.id), { ...user, email: user.email.trim().toLowerCase() });
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

Les utilisateurs sont gardés dans une `Map`, indexée par leur `id` converti en texte.
Ainsi, un `id` numérique (`42`) est bien retrouvé quand `findById()` reçoit `"42"`.

Une version plus complète, utilisée par l'application d'exemple et ses tests, se trouve dans
[examples/basic-express/src/in-memory-user-repository.js](../examples/basic-express/src/in-memory-user-repository.js).

## Exemples avec différentes bases de données

> **À savoir** — Ces exemples montrent comment adapter le contrat. Ils supposent un schéma
> minimal (`id`, `email` unique, `password_hash`, `is_active`) : adaptez les noms au vôtre.
> Ils **ne sont pas couverts par les tests automatisés** du projet, qui n'utilisent aucune
> vraie base de données.

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
 * @returns {import("@kourouma/express-authkit").UserRepository}
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

- `AS "passwordHash"` renomme les colonnes pour qu'elles correspondent au contrat.
- `$1` est un paramètre : il protège contre l'injection SQL. Ne collez jamais l'identifiant
  directement dans le texte de la requête.

**Avec des rôles** : ajoutez une colonne de type liste de textes, puis lisez-la avec les autres.

```sql
ALTER TABLE users ADD COLUMN roles text[] NOT NULL DEFAULT '{}';
UPDATE users SET roles = ARRAY['admin'] WHERE email = 'alice@example.com';
```

```javascript
const AUTH_COLUMNS = 'id::text AS "id", password_hash AS "passwordHash", is_active AS "isActive", roles';
```

Le pilote `pg` renvoie une colonne `text[]` sous forme de tableau JavaScript : rien d'autre à
changer. Voir [rôles et permissions](roles-et-permissions.md).

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
 * @returns {import("@kourouma/express-authkit").UserRepository}
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

- `select` ne lit que les champs utiles.
- Votre `id` est un entier (`Int @id`) ? Renvoyez-le tel quel : il est converti en chaîne
  automatiquement. En revanche, convertissez le paramètre reçu par `findById` :
  `where: { id: Number(id) }`.

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

// `_id` (ObjectId) est converti en chaîne automatiquement par Express AuthKit.
function toAuthRecord(doc) {
  return doc ? { id: doc._id, passwordHash: doc.passwordHash, isActive: doc.isActive } : null;
}

/** @returns {import("@kourouma/express-authkit").UserRepository} */
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

- `select: false` cache `passwordHash` dans toutes les autres requêtes de votre application.
- Le repository le demande explicitement avec `+passwordHash`.
- Un `id` invalide renvoie `null`, pas une erreur : ce n'est pas une panne technique.

## Tester son repository

Vous pouvez vérifier le contrat sans démarrer l'application :

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertUserRepository } from "@kourouma/express-authkit";

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

- Le premier test vérifie que les deux méthodes existent.
- Le second vérifie qu'un utilisateur inconnu donne `null`, sans erreur.

## Pour aller plus loin

### Pourquoi `findById()` est appelée à chaque requête

Un token seul ne sait pas si le compte a été supprimé ou désactivé depuis la connexion. En
relisant l'utilisateur à chaque requête, la bibliothèque bloque **immédiatement** un compte
supprimé ou passé à `isActive: false`. Gardez donc cette requête rapide (index sur `id`).

### Utilisateurs dans une API distante (microservice)

Vos utilisateurs sont gérés par un autre service ? Le repository peut l'interroger en HTTP :

```javascript
/** @returns {import("@kourouma/express-authkit").UserRepository} */
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

- Un 404 devient `null` : l'utilisateur n'existe pas.
- Toute autre erreur est levée : c'est un problème technique.
- `AbortSignal.timeout(2000)` évite d'attendre indéfiniment un service en panne.
- `encodeURIComponent` empêche l'identifiant de modifier le chemin de l'URL.

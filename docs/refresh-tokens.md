# Rester connecté : les refresh tokens

**En bref** : par défaut, le token d'accès expire au bout de 15 minutes, et l'utilisateur doit
alors retaper son mot de passe. Avec les *refresh tokens*, l'application obtient un nouveau token
d'accès toute seule, sans rien demander à l'utilisateur. Cette page explique comment les activer,
où les stocker et comment les utiliser côté client.

## Le principe en 30 secondes

À la connexion, l'utilisateur reçoit **deux** jetons :

| Jeton | Durée de vie | Rôle |
| --- | --- | --- |
| **Token d'accès** (`accessToken`) | 15 minutes | Envoyé à chaque requête pour prouver qui l'on est. |
| **Refresh token** (`refreshToken`) | 14 jours | Sert **uniquement** à obtenir un nouveau token d'accès. |

Quand le token d'accès expire, le client envoie le refresh token à `/auth/refresh` et reçoit une
nouvelle paire de jetons. L'ancien refresh token devient alors inutilisable : c'est la **rotation**.

## Démarrage rapide

**Étape 1 — Activez la fonctionnalité**

```javascript
import { createAuthKit, createInMemoryRefreshTokenStore } from "@express-authkit/core";

const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  refreshTokens: {
    store: createInMemoryRefreshTokenStore() // pour le développement uniquement
  }
});
```

> ⚠️ `createInMemoryRefreshTokenStore()` garde les jetons en mémoire : ils sont perdus au
> redémarrage et ne sont pas partagés entre plusieurs serveurs. En production, utilisez votre
> base de données ([voir plus bas](#stocker-les-jetons-dans-postgresql)).

**Étape 2 — Ajoutez les routes**

```javascript
app.use(express.json());

app.post("/auth/login", expressAuth.login());     // renvoie aussi refreshToken
app.post("/auth/refresh", expressAuth.refresh()); // nouvelle paire de jetons
app.post("/auth/logout", expressAuth.logout());   // déconnexion
```

C'est tout. Voici ce que chaque route reçoit et renvoie :

| Route | Corps envoyé | Réponse |
| --- | --- | --- |
| `/auth/login` | `{ "identifier": "…", "password": "…" }` | `{ accessToken, tokenType, expiresIn, refreshToken, refreshExpiresIn }` |
| `/auth/refresh` | `{ "refreshToken": "…" }` | `{ accessToken, tokenType, expiresIn, refreshToken, refreshExpiresIn }` |
| `/auth/logout` | `{ "refreshToken": "…" }` | `204` (pas de contenu) |

Si le refresh token est invalide, expiré, déjà utilisé ou révoqué, `/auth/refresh` répond **401**
avec le code `REFRESH_TOKEN_INVALID` : le client doit renvoyer l'utilisateur vers la connexion.

## Côté client

```javascript
let session = null; // { accessToken, refreshToken }

async function login(identifier, password) {
  const response = await fetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password })
  });
  session = await response.json();
}

// Appelle l'API ; si le token d'accès a expiré, le renouvelle une fois puis réessaie.
async function apiFetch(url, options = {}) {
  const send = () =>
    fetch(url, { ...options, headers: { ...options.headers, authorization: `Bearer ${session.accessToken}` } });

  let response = await send();
  if (response.status === 401) {
    const refreshed = await fetch("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    if (!refreshed.ok) {
      session = null; // session terminée : retour à l'écran de connexion
      throw new Error("Session expirée");
    }
    session = await refreshed.json();
    response = await send();
  }
  return response;
}
```

Deux règles importantes :

1. **Remplacez toujours** l'ancien refresh token par le nouveau. Un refresh token ne sert qu'une fois.
2. **Ne lancez pas deux rafraîchissements en même temps** (par exemple depuis deux onglets). Le
   second serait pris pour un vol, et la session serait fermée (voir ci-dessous).

## Déconnecter un utilisateur

| Je veux… | Code |
| --- | --- |
| Déconnecter cet appareil | `await auth.logout(refreshToken)` ou la route `expressAuth.logout()` |
| Déconnecter **tous** ses appareils | `await auth.revokeAllSessions(userId)` |

Appelez `revokeAllSessions()` après un **changement de mot de passe**, ou si l'utilisateur
signale un vol de compte :

```javascript
app.post("/auth/logout-all", expressAuth.authenticate(), async (req, res, next) => {
  try {
    await auth.revokeAllSessions(req.auth.userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
```

> Les **tokens d'accès** déjà émis restent valables jusqu'à leur expiration (15 minutes au plus).
> La déconnexion empêche seulement d'en obtenir de nouveaux.

## Stocker les jetons dans PostgreSQL

Vous fournissez un objet `store` avec quatre méthodes. Voici une implémentation complète avec
[`pg`](https://www.npmjs.com/package/pg).

**Étape 1 — Créez la table**

```sql
CREATE TABLE refresh_tokens (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL,
  family_id  text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
```

**Étape 2 — Créez le store**

```javascript
// refresh-token-store.pg.js
const RETURNED_COLUMNS =
  'user_id AS "userId", family_id AS "familyId", extract(epoch FROM expires_at)::float8 AS "expiresAt"';

/**
 * @param {import("pg").Pool} pool
 * @returns {import("@express-authkit/core").RefreshTokenStore}
 */
export function createPgRefreshTokenStore(pool) {
  return {
    async save({ tokenHash, userId, familyId, expiresAt }) {
      await pool.query(
        "INSERT INTO refresh_tokens (token_hash, user_id, family_id, expires_at) VALUES ($1, $2, $3, to_timestamp($4))",
        [tokenHash, userId, familyId, expiresAt]
      );
    },

    async consume(tokenHash) {
      // Atomique : la condition « used_at IS NULL » garantit qu'une seule
      // requête peut marquer le jeton, même si deux arrivent en même temps.
      const updated = await pool.query(
        `UPDATE refresh_tokens SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL
         RETURNING ${RETURNED_COLUMNS}`,
        [tokenHash]
      );
      if (updated.rows.length > 0) {
        return { ...updated.rows[0], alreadyUsed: false };
      }
      // Rien n'a été mis à jour : le jeton est inconnu, ou déjà utilisé.
      const existing = await pool.query(`SELECT ${RETURNED_COLUMNS} FROM refresh_tokens WHERE token_hash = $1`, [
        tokenHash
      ]);
      return existing.rows.length > 0 ? { ...existing.rows[0], alreadyUsed: true } : null;
    },

    async revokeFamily(familyId) {
      await pool.query("DELETE FROM refresh_tokens WHERE family_id = $1", [familyId]);
    },

    async revokeUser(userId) {
      await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);
    }
  };
}
```

**Étape 3 — Branchez-le**

```javascript
import pg from "pg";
import { createPgRefreshTokenStore } from "./refresh-token-store.pg.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  refreshTokens: { store: createPgRefreshTokenStore(pool) }
});
```

> Ce code a été exécuté sur PostgreSQL 17 : rotation, détection de réutilisation,
> déconnexion, `revokeAllSessions()` et **10 rafraîchissements simultanés du même jeton**
> (un seul réussit). Il ne fait pas partie de la suite de tests automatisés du dépôt.

**Étape 4 — Nettoyez les jetons expirés**

Les jetons utilisés sont gardés jusqu'à leur expiration, pour détecter les réutilisations.
Supprimez régulièrement les jetons expirés (tâche planifiée, une fois par jour par exemple) :

```sql
DELETE FROM refresh_tokens WHERE expires_at < now();
```

## Configuration

```javascript
refreshTokens: {
  store,                      // obligatoire
  expiresInSeconds: 1209600   // facultatif : 14 jours par défaut
}
```

| Option | Défaut | Limites | Rôle |
| --- | --- | --- | --- |
| `store` | — | obligatoire | Où les jetons sont enregistrés. |
| `expiresInSeconds` | `1209600` (14 jours) | de 300 s à 90 jours | Durée de vie d'un refresh token. Chaque rafraîchissement repart de zéro : un utilisateur actif reste connecté. |

## Pourquoi c'est sûr

- **Le jeton n'est jamais stocké en clair.** La base ne contient que son empreinte SHA-256. Une
  fuite de la base ne donne aucun jeton utilisable.
- **Le jeton est impossible à deviner** : 256 bits d'aléa, générés par un générateur
  cryptographique.
- **Chaque jeton ne sert qu'une fois** (rotation).
- **Vol détecté** : si un jeton déjà utilisé est présenté à nouveau, la bibliothèque considère
  qu'il a été volé et **ferme toute la session** (la « famille » de jetons issue de la même
  connexion). Le voleur comme la victime doivent se reconnecter.
- **Comptes désactivés ou supprimés** : le rafraîchissement est refusé et la session fermée.
- **Le message d'erreur est toujours le même** pour le client. La raison précise est disponible
  côté serveur dans `error.reason` : `REFRESH_TOKEN_UNKNOWN`, `REFRESH_TOKEN_EXPIRED`,
  `REFRESH_TOKEN_REUSED`, `USER_NOT_FOUND` ou `ACCOUNT_DISABLED`.

## Limites à connaître

- **Où le client garde le refresh token.** Cette version le renvoie dans le corps JSON. Dans un
  navigateur, gardez-le en mémoire plutôt que dans `localStorage` (accessible à un script
  malveillant en cas de faille XSS). Les cookies `HttpOnly` ne sont pas encore disponibles.
- **Deux rafraîchissements simultanés** du même jeton ferment la session (voir « Côté client »).
- **Durée glissante** : un utilisateur actif reste connecté indéfiniment, tant qu'il revient
  avant l'expiration. Il n'y a pas encore de durée maximale absolue.

## Pour aller plus loin : écrire votre propre store

Le contrat `RefreshTokenStore` compte quatre méthodes :

| Méthode | Reçoit | Doit faire |
| --- | --- | --- |
| `save(record)` | `{ tokenHash, userId, familyId, expiresAt }` | Enregistrer le jeton. `expiresAt` est en secondes Unix. |
| `consume(tokenHash)` | l'empreinte du jeton | Marquer le jeton comme utilisé et renvoyer `{ userId, familyId, expiresAt, alreadyUsed }`, ou `null` s'il est inconnu. |
| `revokeFamily(familyId)` | l'identifiant de famille | Supprimer tous les jetons de cette session. |
| `revokeUser(userId)` | l'identifiant utilisateur | Supprimer tous les jetons de cet utilisateur. |

**Le point critique est `consume()` : il doit être atomique.** Si deux requêtes consomment le même
jeton au même moment, une seule doit recevoir `alreadyUsed: false`. Dans l'exemple PostgreSQL,
c'est la condition `WHERE … AND used_at IS NULL` qui le garantit. Avec Redis, utilisez une
commande atomique, par exemple `HSETNX` sur un champ « used » : elle ne réussit que pour la
première requête. (Cette piste n'a pas été testée.)

Les méthodes sont vérifiées au démarrage (`ContractViolationError` si l'une manque), et la
réponse de `consume()` est vérifiée à chaque appel. Pour tester votre store, inspirez-vous de
`tests/security/refresh-tokens.test.js`.

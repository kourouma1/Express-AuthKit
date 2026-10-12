# Limiter les tentatives de connexion

**En bref** : sans limite, un attaquant peut essayer des milliers de mots de passe sur un compte
(attaque par « force brute »). Express AuthKit bloque ces attaques **automatiquement**, sans rien
installer : après 5 échecs, le compte visé est bloqué jusqu'à la fin de la fenêtre de
15 minutes ouverte au premier échec. Cette page explique ce qui se
passe, comment régler les seuils, et quoi faire quand votre API tourne sur plusieurs serveurs.

## Ce qui est activé par défaut

Vous n'avez rien à faire : la protection est active dès `createAuthKit()`.

| Protection | Règle par défaut | Rôle |
| --- | --- | --- |
| **Par compte** | 5 échecs en 15 minutes → compte bloqué jusqu'à la fin de ces 15 minutes | Freine celui qui s'acharne sur un compte, même depuis de nombreuses adresses IP. |
| **Par client** (adresse IP) | 20 tentatives en 15 minutes | Freine une machine qui essaie de nombreux comptes. |

Une connexion réussie remet le compteur du compte à zéro.

Quand la limite est atteinte, la connexion répond **429** avec l'en-tête `Retry-After`
(nombre de secondes à attendre) :

```json
{ "error": { "code": "TOO_MANY_ATTEMPTS", "message": "Trop de tentatives de connexion. Réessayez dans 15 minutes." } }
```

> La limite par client utilise l'adresse IP fournie par `expressAuth.login()`. Si vous appelez
> `auth.login()` vous-même, passez-la en second paramètre avec `clientKeyOf(req)`, qui applique
> les mêmes règles (IPv6 regroupée par /64, adresse inconnue gérée) :
>
> ```javascript
> import { clientKeyOf } from "@express-authkit/core/express";
>
> await auth.login({ identifier, password }, { clientKey: clientKeyOf(req) });
> ```

## Pourquoi c'est sûr

- **Chaque tentative est comptée avant la vérification du mot de passe**, par une opération
  atomique du stockage. Des requêtes envoyées en parallèle ne dépassent donc pas la limite : la
  6e est refusée même si les 5 premières sont encore en cours. Un attaquant bloqué ne coûte
  aucun calcul Argon2id à votre serveur.
- **Un compte inexistant se bloque exactement comme un vrai.** Un attaquant ne peut pas
  deviner quels e-mails sont inscrits en observant les blocages.
- **Pas d'e-mail ni d'adresse IP lisible dans le stockage** : ils y sont remplacés par leur
  empreinte SHA-256. C'est une pseudonymisation, pas un anonymat : quelqu'un qui accède au
  stockage peut recalculer l'empreinte d'une adresse ou d'un e-mail connu.
- **« Alice@Example.com », « alice@example.com » et « ａｌｉｃｅ@example.com » partagent le même
  compteur** (normalisation Unicode NFKC, minuscules, espaces retirés) : changer la casse ne
  permet pas de contourner la limite.
- **Adresses IPv6 regroupées par /64** : un client qui change d'adresse dans son bloc reste limité.
- **Une adresse inconnue n'échappe pas à la limite** : une requête dont la connexion est déjà
  fermée n'est pas traitée, et une adresse illisible compte dans un compteur commun.
- **En cas de panne du stockage**, la connexion est refusée (erreur 500) plutôt que de laisser
  passer des tentatives sans contrôle.

## Régler les seuils

```javascript
const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  loginAttempts: {
    maxFailuresPerIdentifier: 5, // échecs avant blocage d'un compte (1 à 100)
    maxAttemptsPerClient: 20,    // tentatives par adresse IP (1 à 100 000)
    windowSeconds: 900           // fenêtre de comptage, ouverte à la 1re tentative (60 s à 24 h)
  }
});
```

## Plusieurs serveurs : partager les compteurs

Par défaut, les compteurs sont **en mémoire**. Avec plusieurs instances de votre API (load
balancer, plusieurs conteneurs), chacune a ses propres compteurs : avec 3 instances, un attaquant
dispose de 3 fois plus d'essais. Fournissez alors un **stockage partagé**.

Les deux exemples ci-dessous ont été exécutés sur Redis 7 et PostgreSQL 17 : 60 connexions
simultanées sur un même compte, réparties sur 2 instances et 60 adresses IP, donnent exactement
5 vérifications de mot de passe puis des réponses 429, et un compte bloqué via un serveur l'est
aussi sur les autres. Ils ne font pas partie de la suite de tests automatisés du dépôt.

### Avec Redis

```bash
npm install redis
```

```javascript
// attempt-store.redis.js
/**
 * Stockage des tentatives dans Redis (7 ou plus), partagé par toutes les instances.
 *
 * @param {import("redis").RedisClientType} redis Client node-redis déjà connecté.
 * @returns {import("@express-authkit/core").AttemptStore}
 */
export function createRedisAttemptStore(redis) {
  const now = () => Math.floor(Date.now() / 1000);
  return {
    async hit(key, windowSeconds) {
      // Une transaction (MULTI) : incrément et expiration sont atomiques.
      // « NX » ne fixe l'expiration qu'à la première tentative de la fenêtre.
      const [count, , ttl] = await redis.multi().incr(key).expire(key, windowSeconds, "NX").ttl(key).exec();
      return { count: Number(count), resetAt: now() + Number(ttl) };
    },
    async reset(key) {
      await redis.del(key);
    }
  };
}
```

```javascript
import { createClient } from "redis";
import { createRedisAttemptStore } from "./attempt-store.redis.js";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  loginAttempts: { store: createRedisAttemptStore(redis) }
});
```

Redis efface lui-même les compteurs expirés.

### Avec PostgreSQL

```sql
CREATE TABLE login_attempts (
  key      text PRIMARY KEY,
  count    integer NOT NULL,
  reset_at timestamptz NOT NULL
);
```

```javascript
// attempt-store.pg.js
const RETURNING = 'RETURNING count, extract(epoch FROM reset_at)::float8 AS "resetAt"';

/**
 * Stockage des tentatives dans PostgreSQL, partagé par toutes les instances.
 *
 * @param {import("pg").Pool} pool
 * @returns {import("@express-authkit/core").AttemptStore}
 */
export function createPgAttemptStore(pool) {
  return {
    async hit(key, windowSeconds) {
      // Une seule requête atomique : crée le compteur, l'incrémente, ou le
      // redémarre si la fenêtre précédente est terminée.
      const { rows } = await pool.query(
        `INSERT INTO login_attempts (key, count, reset_at)
         VALUES ($1, 1, now() + make_interval(secs => $2))
         ON CONFLICT (key) DO UPDATE SET
           count    = CASE WHEN login_attempts.reset_at <= now() THEN 1 ELSE login_attempts.count + 1 END,
           reset_at = CASE WHEN login_attempts.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE login_attempts.reset_at END
         ${RETURNING}`,
        [key, windowSeconds]
      );
      return rows[0];
    },
    async reset(key) {
      await pool.query("DELETE FROM login_attempts WHERE key = $1", [key]);
    }
  };
}
```

Supprimez régulièrement les compteurs expirés (tâche planifiée) :

```sql
DELETE FROM login_attempts WHERE reset_at < now();
```

## Derrière un proxy ou un load balancer

La limite par client repose sur `req.ip`. Derrière un proxy (Nginx, load balancer, Heroku…),
Express voit l'adresse **du proxy**, pas celle du visiteur : tous vos utilisateurs partageraient
alors le même compteur. Indiquez à Express le nombre de proxys de confiance :

```javascript
app.set("trust proxy", 1); // nombre exact de proxys devant l'application
```

N'utilisez pas `true` : un client pourrait alors falsifier son adresse avec l'en-tête
`X-Forwarded-For` et contourner la limite.

## Désactiver la limitation

Seulement si elle est déjà assurée ailleurs (passerelle d'API, WAF) :

```javascript
createAuthKit({ users, jwt, loginAttempts: false });
```

## Pour aller plus loin

### Écrire votre propre stockage

Le contrat `AttemptStore` compte deux méthodes :

| Méthode | Doit faire |
| --- | --- |
| `hit(key, windowSeconds)` | Ajouter une tentative et renvoyer `{ count, resetAt }`. **Atomique** : c'est ce qui empêche des requêtes parallèles de dépasser la limite. La fenêtre démarre à la première tentative ; à son expiration, le compteur repart de zéro. `resetAt` est en **secondes** Unix (une valeur en millisecondes est refusée). |
| `reset(key)` | Supprimer le compteur. |

Les clés reçues sont déjà hachées (SHA-256). Vérifiez votre stockage avec `assertAttemptStore(store)`.

> Avant la version 1.0.0, le contrat avait aussi une méthode `get(key)`. Elle n'est plus
> appelée : vous pouvez la retirer de votre stockage.

### Le revers du blocage par compte

Un attaquant qui connaît l'e-mail d'un utilisateur peut faire échouer volontairement 5 connexions
pour **bloquer ce compte** jusqu'à la fin de la fenêtre (15 minutes au plus). C'est le compromis habituel de ce type de protection ;
le blocage est temporaire et l'utilisateur légitime n'a rien à faire pour le lever. Pour limiter
cette gêne, augmentez `maxFailuresPerIdentifier` ou réduisez `windowSeconds`.

### Ce que la limite compte exactement

- La fenêtre de 15 minutes s'ouvre à la **première** tentative et ne glisse pas. Un compte bloqué
  l'est jusqu'à la fin de cette fenêtre : si le 5e échec arrive à la 14e minute, le blocage dure
  environ une minute, puis 5 nouveaux essais sont possibles. En moyenne, un attaquant obtient au
  plus 5 essais par fenêtre et par compte.
- Une connexion réussie remet le compteur du compte à zéro. Le compteur utilise la forme
  normalisée de l'identifiant (minuscules, NFKC) : si vos identifiants distinguent les majuscules
  (« Bob » et « bob » sont deux comptes), la connexion réussie de l'un remet aussi à zéro le
  compteur de l'autre. Préférez des identifiants insensibles à la casse.
- Votre `findByIdentifier()` doit retrouver le compte avec la même normalisation (voir
  [repository](repository-utilisateur.md#règles-importantes)). Une recherche plus permissive
  (par exemple une collation MySQL qui ignore les accents) donnerait plusieurs compteurs pour un
  même compte.

### Le stockage en mémoire

Le stockage par défaut garde au plus 100 000 compteurs (environ 15 Mo). Au-delà, les plus anciens
sont oubliés : un attaquant qui crée des dizaines de milliers de compteurs (avec un grand bloc
d'adresses IPv6) peut ainsi lever un blocage plus tôt que prévu. En production exposée sur
Internet, préférez Redis ou PostgreSQL. La limite se règle :
`loginAttempts: { store: createInMemoryAttemptStore({ maxEntries: 500_000 }) }`.

### Suivre les blocages

Chaque blocage produit un événement d'audit (`account.locked`, `login.blocked`) :
voir [le journal d'audit](audit.md).

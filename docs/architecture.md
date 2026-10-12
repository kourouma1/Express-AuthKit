# Architecture

**En bref** : cette page explique comment le code d'Express AuthKit est organisé et pourquoi.
Elle s'adresse surtout aux contributeurs et à ceux qui veulent remplacer une brique. Après
lecture, vous saurez où se trouve chaque partie du code et où brancher une future
fonctionnalité.

## L'idée principale

Express AuthKit suit une **architecture hexagonale** (version légère). L'idée est simple :

- Au centre, il y a le **Core** : la logique d'authentification (« ce mot de passe est-il
  bon ? », « ce token est-il valide ? »).
- Le Core ne connaît **ni Express, ni votre base de données, ni les bibliothèques de
  cryptographie**.
- Il communique avec l'extérieur par des **contrats**. Un contrat est une liste de méthodes
  qu'un objet doit fournir. Par exemple : « donne-moi un utilisateur à partir de son e-mail ».
- D'autres modules **implémentent** ces contrats : votre code pour la base de données, Argon2
  pour les mots de passe, `jose` pour les tokens.

Avantage : on peut changer une brique (passer de PostgreSQL à MongoDB, de HMAC à Ed25519,
d'Express à un autre framework) sans toucher au Core.

```text
                ┌──────────────────────────────────────────────┐
  Application   │  Factory : createAuthKit(options)            │
  Express  ───► │   ├─ Configuration (validation, défauts)     │
                │   ├─ Providers (Argon2id, JWT/jose)          │
                │   └─ Core : AuthenticationService            │
                │        ▲         ▲              ▲            │
                │  UserRepository  PasswordProvider TokenProvider (contrats)
                └────────┼─────────────────────────────────────┘
                         │
              Votre code (Prisma, Mongoose, SQL, API…)

  Adaptateur Express : createExpressAuth(auth) ──► auth.verifyAccessToken()
```

## Les modules

| Module | Rôle |
| --- | --- |
| **Core** — `src/core/` | La logique : `login()` et `verifyAccessToken()`, les erreurs, les limites de taille des entrées, les contrats. |
| **Configuration** — `src/config/` | Valide les options, applique des valeurs sûres par défaut, refuse les réglages dangereux. |
| **Providers** — `src/providers/` | Les implémentations par défaut : Argon2id (mots de passe) et JWT HMAC via `jose` (tokens). |
| **Factory** — `src/factory/` | `createAuthKit()` : assemble toutes les briques. C'est le seul endroit qui les connaît toutes. |
| **Adaptateur** — `src/adapters/express/` | Fait le lien entre HTTP et le Core : lit le token `Bearer`, appelle le Core, transforme les erreurs en statuts HTTP. |

Quelques détails utiles :

- **Core** (`authentication-service.js`) : il valide les entrées et applique les règles de
  sécurité (message d'erreur identique, compte actif obligatoire, égalisation du temps de
  réponse). Il ne garde **aucun état par utilisateur**.
- **Configuration** : elle refuse un secret absent, court ou faible, un algorithme hors
  liste, une durée de vie trop longue, des coûts Argon2id trop faibles et les options
  inconnues.
- **Adaptateur** : il ajoute aussi l'en-tête `WWW-Authenticate` aux réponses 401.

## Les contrats

JavaScript n'a pas d'interfaces (comme en Java ou TypeScript). Chaque contrat est donc :

1. décrit en JSDoc (`@typedef`), pour l'autocomplétion dans VS Code, WebStorm… ;
2. vérifié **au démarrage** : l'objet a-t-il les bonnes méthodes ? (`assertUserRepository()`, etc.) ;
3. vérifié **pendant l'exécution** : les données renvoyées ont-elles la bonne forme ?
   (par exemple un utilisateur renvoyé par le repository).

| Contrat | Méthodes |
| --- | --- |
| `UserRepository` | `findByIdentifier(identifier)`, `findById(id)` |
| `PasswordProvider` | `hash(password)`, `verify(password, hash)` |
| `TokenProvider` | `issue({ subject })`, `verify(token)` |
| `AuthenticationService` | `login(credentials)`, `verifyAccessToken(token)` |
| `AuthPrincipal` | objet figé `{ userId, tokenId, issuedAt, expiresAt }` |

## Règles d'import

Les dépendances pointent **vers le Core**, jamais l'inverse :

| Module | Peut importer | Ne doit jamais importer |
| --- | --- | --- |
| `src/core/` | `src/core/` uniquement | Express, ORM, `jose`, `argon2`, providers, config |
| `src/config/` | `src/core/errors.js` | Express, providers |
| `src/providers/` | `src/core/`, `src/config/`, `jose`, `argon2` | Express |
| `src/adapters/express/` | `src/core/`, `src/config/` | `express` (aucun import nécessaire) |
| `src/factory/` | tout sauf les adaptateurs | — |

`tests/unit/architecture.test.js` vérifie automatiquement une partie de ces règles :

- le Core n'importe que des fichiers du Core ;
- l'adaptateur n'importe pas `express` ;
- il n'y a aucun import circulaire ;
- la bibliothèque n'utilise jamais `console`.

Les autres lignes du tableau (config, providers, factory) sont des conventions, à respecter
lors des revues de code.

## Arborescence du dépôt

```text
Express-AuthKit/
├── src/
│   ├── index.js                    # entrée publique "@kourouma/express-authkit"
│   ├── core/
│   │   ├── authentication-service.js
│   │   ├── errors.js
│   │   ├── input-limits.js
│   │   └── contracts/
│   ├── config/
│   ├── providers/
│   ├── factory/
│   └── adapters/express/index.js   # entrée publique "@kourouma/express-authkit/express"
├── tests/                          # unit / security / integration / helpers
├── examples/basic-express/         # application complète et testée
├── scripts/verify-package.js       # test du tarball dans un projet vierge
├── docs/
└── .github/workflows/ci.yml
```

## Plusieurs instances

Vous pouvez lancer plusieurs copies de l'application (processus, conteneurs, derrière un
load balancer) :

- Les JWT sont **sans état** : le serveur ne garde pas de liste de tokens. N'importe quelle
  instance peut vérifier un token émis par une autre. Il suffit qu'elles partagent
  `AUTH_SECRET`, `issuer` et `audience`.
- Aucune donnée par utilisateur n'est gardée en mémoire.
- Seul état interne : un hash factice, calculé une fois par processus et identique pour tous
  (il sert à égaliser le temps de réponse).
- La limitation des tentatives est à la charge de l'application. Voir
  l'[exemple Redis multi-instances](securite.md#limitation-des-tentatives-de-connexion).
- Synchronisez les horloges des serveurs (NTP). L'option `jwt.clockToleranceSeconds`
  absorbe un léger décalage.

## Points d'extension futurs

Ces fonctionnalités **ne sont pas disponibles** en 0.1.0. Le tableau indique où elles
pourraient s'ajouter sans tout réécrire.

| Fonctionnalité | Où elle s'intégrerait |
| --- | --- |
| Liste de révocation (tokens bloqués avant leur expiration) | Contrat facultatif interrogé par `verifyAccessToken()` avec le `tokenId`. |
| Hiérarchie de rôles et droits par objet (ACL) | Extension de `isAuthorized()` ; en attendant, la règle `check` couvre ces cas. |
| Audit | Hook facultatif qui recevrait les événements (`login.succeeded`, `login.failed` avec `error.reason`). |
| Clés asymétriques (RS/ES/EdDSA, JWKS) | Nouveau `TokenProvider`. Le contrat ne dépend déjà d'aucun algorithme. |
| Sessions / cookies | Nouvel adaptateur ou nouvelle option de l'adaptateur Express, sans changer le Core. |
| OAuth / OIDC (connexion via Google, GitHub…) | Nouveau cas d'usage qui produirait un principal via le même `TokenProvider`. |
| Fastify, Koa, Hono… | Nouveau dossier `src/adapters/<framework>/` et nouvelle entrée dans `exports`. |
| Ré-hachage progressif | Méthode facultative `needsRehash()` sur `PasswordProvider`. |

## Pour aller plus loin

### Décisions de conception

| Décision | Pourquoi |
| --- | --- |
| **JavaScript + JSDoc, sans TypeScript** | Exigence du projet. Pas d'étape de build pour le code : le code publié est le code source. Les déclarations de types (`types/*.d.ts`) sont **générées** depuis le JSDoc avant la publication, jamais écrites à la main. |
| **Rôles relus à chaque requête, jamais dans le JWT** | `findById()` est déjà appelé à chaque requête : les rôles en profitent. Un changement de rôle s'applique tout de suite, et le token reste petit. `authorize()` ne fait confiance qu'aux requêtes authentifiées par la même instance (registre interne, pas `req.auth`). |
| **Refresh tokens opaques, stockés hachés** | Un jeton aléatoire (pas un JWT) peut être révoqué à tout moment. Seule son empreinte SHA-256 est stockée. Rotation à chaque usage et révocation de la famille en cas de réutilisation (OAuth 2.0 Security BCP). |
| **Node.js ≥ 22.12, 24 LTS recommandé** | Versions LTS maintenues en 2026. Elles fournissent `fetch`, `crypto.randomUUID`, `--env-file` et un test runner stable. Node 20 n'est plus maintenu depuis avril 2026. |
| **`jose`** pour les JWT | Sans dépendance, maintenue, conforme aux RFC. API stricte : liste d'algorithmes, `typ`, champs obligatoires. |
| **`argon2`** pour les mots de passe | Implémentation de référence, binaires précompilés, comparaison en temps constant. Le `crypto.argon2` natif de Node 24.7+ est encore expérimental. |
| **HMAC (HS256/384/512) uniquement** en 0.1.0 | Le plus simple à déployer correctement avec un secret partagé. Les clés asymétriques passent par `providers.token`. |
| **`typ: at+jwt`** exigé (RFC 9068) | Empêche qu'un autre JWT signé avec la même clé soit accepté comme token d'accès. |
| **Vérification de l'utilisateur à chaque requête** | Permet de refuser tout de suite un compte désactivé ou supprimé, ce qu'un JWT seul ne permet pas. Coût : une lecture en base par requête (voir [sécurité](securite.md#révocation-des-jwt)). |
| **`isActive` doit valoir exactement `true`** | Principe « fail-closed » (fermé par défaut) : une donnée manquante ne donne jamais accès. |
| **Pas d'import d'Express dans l'adaptateur** | Un middleware est une simple fonction `(req, res, next)`. Express reste une *peer dependency* facultative. |
| **Objets retournés figés** (`Object.freeze`) | Un autre middleware ne peut pas modifier par erreur l'API publique ni `req.auth`. |
| **Node.js Test Runner + `fetch`** | Aucun framework de test ni `supertest` à installer. |

### Compatibilité CommonJS (future)

Le package est **ESM uniquement** (il utilise `import`, pas `require`).

Depuis Node.js 22.12, `require()` peut charger un module ES synchrone par défaut. En
pratique, un projet CommonJS peut donc déjà charger `@kourouma/express-authkit` avec `require()` sur
les versions supportées. Mais ce n'est **ni testé ni garanti** en 0.1.0.

Une compatibilité officielle demanderait :

1. des tests CI dédiés à `require("@kourouma/express-authkit")` ;
2. une condition `"require"` explicite dans `exports`, si une variante générée devient nécessaire ;
3. l'absence de `top-level await` dans `src/` (déjà le cas, à préserver).

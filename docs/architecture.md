# Architecture

Ce document décrit l'organisation interne d'Express AuthKit, les décisions de conception
et les points d'extension prévus. Il s'adresse aux contributeurs et aux développeurs qui
souhaitent remplacer une brique de la bibliothèque.

## Vue d'ensemble

Express AuthKit suit une **architecture hexagonale légère** : la logique d'authentification
(le *Core*) ne connaît ni Express, ni la base de données, ni les bibliothèques
cryptographiques. Elle dépend uniquement de **contrats** que d'autres modules implémentent.

```
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

Les dépendances pointent **vers le Core** :

| Module | Peut importer | Ne doit jamais importer |
| --- | --- | --- |
| `src/core/` | `src/core/` uniquement | Express, ORM, `jose`, `argon2`, providers, config |
| `src/config/` | `src/core/errors.js` | Express, providers |
| `src/providers/` | `src/core/`, `src/config/`, `jose`, `argon2` | Express |
| `src/adapters/express/` | `src/core/`, `src/config/` | `express` (aucun import nécessaire) |
| `src/factory/` | tout sauf les adaptateurs | — |

Ces règles, l'absence d'import circulaire et l'absence de `console` dans la bibliothèque
sont vérifiées par `tests/unit/architecture.test.js`.

## Responsabilités

### Core — `src/core/`

- `authentication-service.js` : cas d'usage `login()` et `verifyAccessToken()`.
  Valide les entrées, applique la politique (message générique, compte actif, atténuation
  temporelle) et orchestre les contrats. Aucun état par utilisateur.
- `errors.js` : classes d'erreur et codes stables (`AUTH_ERROR_CODES`).
- `input-limits.js` : bornes de taille appliquées aux données non fiables.
- `contracts/` : contrats documentés en JSDoc et leurs vérifications à l'exécution.

### Contracts — `src/core/contracts/`

JavaScript n'a pas d'interfaces. Chaque contrat est donc :

1. décrit par un `@typedef` JSDoc (autocomplétion dans VS Code, WebStorm…) ;
2. vérifié **structurellement au démarrage** (`assertUserRepository()`, etc.) ;
3. vérifié **à l'exécution** pour les données renvoyées (`normalizeUserRecord()`).

| Contrat | Méthodes |
| --- | --- |
| `UserRepository` | `findByIdentifier(identifier)`, `findById(id)` |
| `PasswordProvider` | `hash(password)`, `verify(password, hash)` |
| `TokenProvider` | `issue({ subject })`, `verify(token)` |
| `AuthenticationService` | `login(credentials)`, `verifyAccessToken(token)` |
| `AuthPrincipal` | objet figé `{ userId, tokenId, issuedAt, expiresAt }` |

### Providers — `src/providers/`

- `argon2-password-provider.js` : Argon2id via le paquet `argon2` (implémentation C de référence).
- `jwt-token-provider.js` : JWT HMAC via `jose`.

### Configuration — `src/config/`

Validation des options, valeurs sûres par défaut, refus des configurations dangereuses
(secret absent/court/faible, algorithme hors liste, durée de vie excessive, coûts Argon2id
trop faibles, options inconnues).

### Factory — `src/factory/`

`createAuthKit()` valide les options, construit ou reçoit les providers, vérifie les
contrats puis assemble le service. C'est le seul endroit qui connaît toutes les briques.

### Adapters — `src/adapters/express/`

Traduit HTTP ↔ Core : extraction du jeton `Bearer`, appel à `auth.verifyAccessToken()`,
correspondance code d'erreur → statut HTTP, en-tête `WWW-Authenticate`.

## Arborescence du dépôt

```
express-authkit/
├── src/
│   ├── index.js                    # entrée publique "express-authkit"
│   ├── core/
│   │   ├── authentication-service.js
│   │   ├── errors.js
│   │   ├── input-limits.js
│   │   └── contracts/
│   ├── config/
│   ├── providers/
│   ├── factory/
│   └── adapters/express/index.js   # entrée publique "express-authkit/express"
├── tests/                          # unit / security / integration / helpers
├── examples/basic-express/         # application complète et testée
├── scripts/verify-package.js       # test du tarball dans un projet vierge
├── docs/
└── .github/workflows/ci.yml
```

## Décisions de conception

| Décision | Justification |
| --- | --- |
| **JavaScript + JSDoc, sans TypeScript** | Exigence du projet ; aucune étape de build, le code publié est le code source. |
| **Node.js ≥ 22.12, 24 LTS recommandé** | Versions LTS maintenues en 2026 ; `fetch`, `crypto.randomUUID`, `--env-file`, test runner stable. Node 20 n'est plus maintenu depuis avril 2026. |
| **`jose`** pour les JWT | Bibliothèque sans dépendance, maintenue, conforme aux RFC, API stricte (liste d'algorithmes, `typ`, claims obligatoires). |
| **`argon2`** pour les mots de passe | Implémentation de référence, binaires précompilés, comparaison en temps constant. Le `crypto.argon2` natif de Node 24.7+ est encore expérimental. |
| **HMAC (HS256/384/512) uniquement** en 0.1.0 | Le plus simple à déployer correctement avec un secret partagé. Les clés asymétriques sont un point d'extension (`providers.token`). |
| **`typ: at+jwt`** exigé (RFC 9068) | Empêche qu'un autre JWT signé avec la même clé soit accepté comme jeton d'accès. |
| **Vérification de l'utilisateur à chaque requête** | Permet de refuser immédiatement un compte désactivé ou supprimé, ce qu'un JWT seul ne permet pas. Coût : une lecture par requête (voir [sécurité](securite.md#révocation-des-jwt)). |
| **`isActive` doit valoir exactement `true`** | Comportement « fail-closed » : une donnée manquante ne donne jamais accès. |
| **Pas d'import d'Express dans l'adaptateur** | Le middleware est une simple fonction `(req, res, next)` ; Express reste une *peer dependency* facultative. |
| **Objets retournés figés** (`Object.freeze`) | L'API publique et `req.auth` ne peuvent pas être modifiés par erreur par un autre middleware. |
| **Node.js Test Runner + `fetch`** | Aucun framework de test ni `supertest` à installer. |

## Scalabilité

- Les **JWT d'accès sont sans état** : n'importe quelle instance peut vérifier un jeton émis
  par une autre, il suffit qu'elles partagent `AUTH_SECRET`, `issuer` et `audience`.
- Aucun état mutable par utilisateur n'est conservé en mémoire : l'application peut tourner
  derrière un load balancer, sur plusieurs processus ou conteneurs.
- Le seul état interne est un hash factice calculé une fois par processus (atténuation
  temporelle), identique pour tous les utilisateurs.
- La limitation des tentatives est déléguée à l'application, avec un
  [exemple Redis multi-instances](securite.md#limitation-des-tentatives-de-connexion).
- Synchronisez les horloges (NTP) ; `jwt.clockToleranceSeconds` absorbe un léger décalage.

## Points d'extension futurs

Ces fonctionnalités **ne sont pas implémentées** en 0.1.0. Voici où elles s'intégreraient
sans réécriture :

| Fonctionnalité | Point d'extension prévu |
| --- | --- |
| Refresh tokens | Nouveau contrat `RefreshTokenStore` (persistance + rotation) et cas d'usage `refresh()` dans le Core. Le `jti` déjà présent sert d'identifiant. |
| Liste de révocation | Contrat facultatif interrogé par `verifyAccessToken()` avec `tokenId`. |
| RBAC / permissions | Enrichissement contrôlé du principal à partir du repository, puis middleware `authorize()` dans l'adaptateur. |
| Audit | Hook facultatif recevant les événements (`login.succeeded`, `login.failed` avec `error.reason`). |
| Clés asymétriques (RS/ES/EdDSA, JWKS) | Nouveau `TokenProvider` ; le contrat est déjà indépendant de l'algorithme. |
| Sessions / cookies | Nouvel adaptateur ou option de l'adaptateur Express, sans changer le Core. |
| OAuth / OIDC | Nouveau cas d'usage produisant un principal via le même `TokenProvider`. |
| Fastify, Koa, Hono… | Nouveau dossier `src/adapters/<framework>/` et nouvelle entrée dans `exports`. |
| Ré-hachage progressif | Méthode facultative `needsRehash()` sur `PasswordProvider`. |

## Compatibilité CommonJS (future)

Le package est **ESM uniquement**. Depuis Node.js 22.12, `require()` d'un module ES
synchrone est pris en charge par défaut ; en pratique, un projet CommonJS peut donc déjà
charger `express-authkit` avec `require()` sur les versions supportées, mais ce n'est
**ni testé ni garanti** en 0.1.0. Une compatibilité officielle demanderait :

1. des tests CI dédiés à `require("express-authkit")` ;
2. une condition `"require"` explicite dans `exports` si une variante générée devient nécessaire ;
3. l'absence de `top-level await` dans `src/` (déjà le cas, à préserver).

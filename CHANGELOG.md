# Historique des versions

Toutes les évolutions notables d'Express AuthKit sont consignées ici.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
et le projet suit le [Versionnage sémantique](https://semver.org/lang/fr/).

## Politique de versions

À partir de la version 1.0.0, l'API publique est **stable** :

- **MAJEURE** (`1.0.0` → `2.0.0`) : changement incompatible de l'API publique
  (exports, signatures, codes d'erreur, format de `req.auth`, contrats des stockages).
- **MINEURE** (`1.0.0` → `1.1.0`) : nouvelle fonctionnalité rétrocompatible.
- **CORRECTIF** (`1.0.0` → `1.0.1`) : correction de bug ou de sécurité rétrocompatible.

L'API publique se limite aux exports de `@express-authkit/core` et
`@express-authkit/core/express`, aux codes d'erreur (`AUTH_ERROR_CODES`), aux types
d'événements d'audit (`AUDIT_EVENTS`) et aux contrats documentés. Les messages d'erreur
(en français) peuvent être améliorés dans une version mineure : basez votre code sur les codes,
pas sur les messages. Les correctifs de sécurité sont publiés pour la dernière version 1.x
(voir [SECURITY.md](SECURITY.md)).

## [Non publié]

## [1.0.0] — 2026-10-12

Première version stable. Elle reprend la version candidate 0.1.0 et ajoute la limitation des
tentatives, le journal d'audit et une gestion minimale des comptes, après une revue de sécurité
interne.

### Ajouté

- **Limitation des tentatives de connexion intégrée**, active par défaut : 5 échecs par compte
  et 20 tentatives par adresse IP sur une fenêtre de 15 minutes. Réponse 429
  `TOO_MANY_ATTEMPTS` avec l'en-tête `Retry-After`. Option `loginAttempts` (`store`,
  `maxFailuresPerIdentifier`, `maxAttemptsPerClient`, `windowSeconds`, ou `false`), contrat
  `AttemptStore` (`hit`, `reset`), `assertAttemptStore()`, `createInMemoryAttemptStore({ maxEntries })`,
  erreur `TooManyAttemptsError`. Chaque tentative est comptée de façon atomique **avant** la
  vérification du mot de passe : des requêtes parallèles ne dépassent pas la limite.
  Identifiants (normalisés NFKC, minuscules) et adresses IP pseudonymisés en SHA-256 dans le
  stockage ; IPv6 regroupée par /64.
- **Journal d'audit** : option `audit` et constante `AUDIT_EVENTS` — connexions, échecs,
  blocages, jetons refusés, accès refusés, refresh, vol de session détecté, déconnexions,
  ré-hachages. La bibliothèque n'y place aucun mot de passe, hash ni jeton. Les erreurs du
  gestionnaire deviennent des avertissements Node.js `EXPRESS_AUTHKIT_AUDIT`.
- **Modernisation automatique des hash** à la connexion : `needsRehash()` facultative sur
  `PasswordProvider` (implémentée par le provider Argon2id, sans jamais abaisser les coûts) et
  `updatePasswordHash()` facultative sur `UserRepository`. Un échec ne bloque pas la connexion
  (avertissement `EXPRESS_AUTHKIT_REHASH`).
- `isPasswordCompromised(password)` : vérification Have I Been Pwned par k-anonymat. Une réponse
  illisible (portail captif, proxy) lève `DependencyFailureError` au lieu de passer pour
  « non compromis ».
- `auth.login(credentials, context?)` et `auth.verifyAccessToken(token, context?)` : second
  paramètre facultatif `{ clientKey }`, rempli automatiquement par l'adaptateur Express.
- `clientKeyOf(req)`, exporté par `@express-authkit/core/express`, pour les routes de connexion
  personnalisées.
- Raison interne `AUTH_FAILURE_REASONS.INVALID_PASSWORD_HASH`.

### Sécurité

- **Rotation des refresh tokens** : une révocation (déconnexion, `revokeAllSessions()`, vol
  détecté) survenue pendant une rotation en cours ne laisse plus survivre le nouveau jeton.
  Deux rafraîchissements simultanés du même jeton ferment désormais toujours la session, comme
  le documentait déjà le guide.
- **Hash illisible en base** : `login()` répondait 500 pour un compte existant, et 401 pour un
  compte inconnu, ce qui révélait l'existence du compte ; la tentative n'était pas comptée. C'est
  désormais un `INVALID_CREDENTIALS` ordinaire, compté, signalé par l'audit et par
  l'avertissement `EXPRESS_AUTHKIT_PASSWORD_HASH`.
- Une requête de connexion dont la connexion TCP est déjà fermée n'est plus traitée, et une
  adresse IP inconnue compte dans un compteur commun au lieu d'échapper à la limite par client.
- Secret JWT : les tableaux d'octets (`Buffer`) passent les mêmes contrôles que les chaînes, et
  un secret entouré d'espaces ou d'un retour à la ligne (`.env` Windows) est refusé.
- L'événement `password.rehash_failed` ne contient plus l'erreur d'origine (qui pouvait
  contenir une requête SQL), seulement `{ code, dependency }`.

### Incompatible (par rapport à 0.1.0-rc.1)

- La limitation des tentatives est active par défaut : une suite de tests qui enchaîne les
  échecs de connexion peut recevoir 429. Passez `loginAttempts: false` ou un seuil plus haut
  dans ces tests.
- `RefreshTokenStore` : `revokeFamily()` et `revokeUser()` doivent supprimer aussi les jetons
  déjà utilisés, et `consume()` ne doit jamais renvoyer un jeton en cours de révocation (avec
  SQL : `SELECT … FOR SHARE`, voir l'exemple PostgreSQL mis à jour).
- Un hash stocké illisible ne produit plus `InvalidPasswordHashError` pendant `login()` (voir
  ci-dessus). `auth.password.verify()` la lève toujours.
- `AttemptStore.get()` n'est plus utilisé ni exigé.
- Node.js **22.14 ou plus récent** est exigé (au lieu de 22.12) : le module natif `argon2`
  plante sur Node 22.12 et 22.13.

### Modifié

- L'exemple `basic-express` n'utilise plus `express-rate-limit` ni `rate-limit-redis`.
- Gestion d'erreur unique dans l'adaptateur Express.

## [0.1.0-rc.1] — candidate (non maintenue)

Le paquet est publié sous le nom **`@express-authkit/core`**, dans l'organisation npm
`express-authkit` (gérée à plusieurs). npm refuse le nom `express-authkit`, jugé trop proche du
paquet existant `express-auth-kit`. Une première version candidate avait été publiée sous
`@kourouma/express-authkit` : ce nom est abandonné. La commande `npx express-authkit` garde son nom.

### Ajouté

- `createAuthKit()` : moteur d'authentification configurable par injection de dépendances.
- Hachage et vérification des mots de passe avec Argon2id (`auth.password.hash()`, `auth.password.verify()`).
- Émission de JWT d'accès signés HMAC (HS256 par défaut) avec `jose`, en-tête `typ: at+jwt`.
- Vérification stricte des JWT : signature, algorithme autorisé, `exp`, `iat`, `iss`, `aud`, `sub`, `jti`.
- `auth.login()` : authentification identifiant / mot de passe avec message d'erreur générique
  et atténuation des écarts de temps de réponse pour les comptes inexistants.
- `auth.verifyAccessToken()` : contrôle de l'existence et du statut actif de l'utilisateur à chaque requête.
- Adaptateur Express `createExpressAuth()` : `authenticate()`, `login()` et `errorHandler()`.
- Contrats `UserRepository`, `PasswordProvider`, `TokenProvider` documentés en JSDoc et vérifiés au démarrage.
- Erreurs structurées avec codes stables (`AUTH_ERROR_CODES`).
- Validation de la configuration : secret absent, court ou manifestement faible refusé,
  paramètres Argon2id sous le plancher OWASP refusés, options inconnues refusées.
- `expressAuth.login(options?)` : handler de connexion prêt à l'emploi
  (`app.post("/login", express.json(), expressAuth.login())`), avec l'option `identifierField`.
  Il ne crée aucune route : l'application choisit l'URL.
- Commande `npx express-authkit secret` pour générer un secret JWT.
- Les `id` renvoyés par le repository peuvent être des entiers, des `BigInt` ou des `ObjectId`
  MongoDB : ils sont convertis automatiquement en chaîne.
- Tous les messages d'erreur sont en français, centralisés dans un seul module, et indiquent
  comment corriger le problème. Les codes d'erreur restent stables (en anglais).
- `DependencyFailureError` (`DEPENDENCY_FAILURE`) : toute panne d'un repository ou d'un provider
  est enveloppée, avec `dependency` (l'appel qui a échoué) et `cause` (l'erreur d'origine).
- `AuthKitError#toJSON()` : sérialisation sûre `{ name, code, message }`, sans pile ni cause.
- `expressAuth.errorHandler()` convertit aussi les erreurs du parseur `express.json()`
  (JSON mal formé → 400, corps trop volumineux → 413) en réponses JSON.
- Oublier les parenthèses (`expressAuth.authenticate` au lieu de `expressAuth.authenticate()`)
  lève une `ConfigurationError` explicite au lieu de bloquer la requête.
- `expressAuth.login({ identifierField })` cite le vrai nom du champ dans ses messages.
- **Refresh tokens** (option `refreshTokens: { store, expiresInSeconds }`, désactivée par défaut) :
  `auth.refresh()`, `auth.logout()`, `auth.revokeAllSessions()`, handlers Express
  `expressAuth.refresh()` et `expressAuth.logout()`. Jetons opaques de 256 bits, stockés sous forme
  d'empreinte SHA-256, rotation à chaque usage, révocation de toute la session en cas de
  réutilisation. Contrat `RefreshTokenStore` (`save`, `consume`, `revokeFamily`, `revokeUser`),
  `createInMemoryRefreshTokenStore()` pour le développement, exemple PostgreSQL documenté.
- **Rôles et permissions** : `expressAuth.authorize(rule)` (rôle, `anyRole`, `allPermissions`,
  règle `check` personnalisée), `isAuthorized()` hors d'Express, nouvelle erreur
  `AccessDeniedError` (`ACCESS_DENIED`, 403). Le repository peut renvoyer `roles` et
  `permissions` : ils sont relus à chaque requête (changement immédiat), exposés dans
  `req.auth`, et jamais écrits dans le JWT.
- Nouvelle erreur `InvalidRefreshTokenError` (`REFRESH_TOKEN_INVALID`, 401).
- **Types TypeScript** générés depuis le JSDoc (`types/*.d.ts`, champ `types` et conditions
  `types` dans `exports`), avec `req.auth` typé pour Express. Script `npm run typecheck` :
  le code source passe la vérification TypeScript en mode strict.
- Le type de `jwt.secret` accepte `undefined` : `secret: process.env.AUTH_SECRET` compile en
  TypeScript sans `!` (une valeur absente reste refusée au démarrage, avec un message clair).
- Démarrage rapide TypeScript dans `docs/typescript.md`, compilé et exécuté par
  `npm run test:package`, avec les trois différences à connaître par rapport aux exemples JavaScript.
- `TokenProvider.issue()` est vérifié : un provider personnalisé qui renvoie un jeton mal formé
  lève une `ContractViolationError`.

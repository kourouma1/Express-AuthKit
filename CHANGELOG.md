# Historique des versions

Toutes les évolutions notables d'Express AuthKit sont consignées ici.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
et le projet suit le [Versionnage sémantique](https://semver.org/lang/fr/).

## Politique de versions

- **MAJEURE** (`1.0.0` → `2.0.0`) : changement incompatible de l'API publique
  (exports, signatures, codes d'erreur, format de `req.auth`).
- **MINEURE** (`0.1.0` → `0.2.0`) : nouvelle fonctionnalité rétrocompatible.
- **CORRECTIF** (`0.1.0` → `0.1.1`) : correction de bug ou de sécurité rétrocompatible.

Tant que le projet est en `0.x`, une version mineure peut contenir des
changements incompatibles ; ils seront toujours signalés dans ce fichier
sous la rubrique **Incompatible**. L'API publique se limite aux exports de
`express-authkit` et `express-authkit/express`.

## [Non publié]

## [0.1.0] — candidate

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

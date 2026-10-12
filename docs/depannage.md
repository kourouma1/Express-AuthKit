# Dépannage et erreurs courantes

## Au démarrage

### `ConfigurationError: `jwt.secret` is required.`

`process.env.AUTH_SECRET` est vide. Vérifiez que le fichier `.env` est chargé :

```bash
node --env-file=.env server.js   # Node.js 22+, sans dépendance
```

ou que la variable est définie dans votre environnement d'exécution (Docker, systemd, CI…).

### `` `jwt.secret` must be at least 32 bytes long `` / `looks like a placeholder value` / `is too repetitive`

Le secret est trop court ou ressemble à une valeur d'exemple. Générez-en un nouveau :

```bash
npx express-authkit secret
```

Avec `HS384` il faut au moins 48 octets, avec `HS512` au moins 64.

### `Unknown option(s) in `jwt`: expiresIn`

Le nom de l'option est `expiresInSeconds` et la valeur un entier (`900`, pas `"15m"`).
La liste des options autorisées est affichée dans le message.

### `ContractViolationError: UserRepository must implement: findById().`

Votre objet `users` ne possède pas les deux méthodes `findByIdentifier()` et `findById()`.
Si vous utilisez une classe, passez une **instance** (`new UserRepository()`), pas la classe.

### `Use either `jwt` options or `providers.token`, not both.`

Avec un provider de token personnalisé, supprimez l'option `jwt` (elle serait ignorée).

### `SyntaxError: Cannot use import statement outside a module`

Votre projet est en CommonJS. Ajoutez `"type": "module"` à votre `package.json`
(`npm pkg set type=module`) ou renommez vos fichiers en `.mjs`.

### `ERR_PACKAGE_PATH_NOT_EXPORTED`

Vous importez un fichier interne (`express-authkit/src/...`). Utilisez uniquement
`express-authkit` et `express-authkit/express`.

### Installation de `argon2` impossible

`argon2` est un module natif livré avec des binaires précompilés pour les plateformes courantes
(Linux glibc/musl, macOS, Windows ; x64 et arm64).

- **npm 11 et les scripts d'installation** : si npm affiche
  `package has install scripts not yet covered by allowScripts`, les binaires précompilés sont
  en général utilisés quand même. Vérifiez avec
  `node -e "import('argon2').then(() => console.log('ok'))"`. Si le chargement échoue,
  autorisez le script : `npm approve-scripts argon2`.
- **Plateforme sans binaire précompilé** : installez une chaîne de compilation
  (`python3`, `make`, `g++` ; sur Alpine : `apk add --no-cache python3 make g++`).
- **Docker** : installez les dépendances **dans** l'image (`npm ci` dans le `Dockerfile`),
  ne copiez pas un `node_modules` construit sur une autre plateforme.

### `EADDRINUSE` ou réponse HTML inattendue sur `localhost:3000`

Un autre programme utilise déjà le port 3000 (conteneur Docker, autre serveur de
développement). Changez le port dans `app.listen(…)`, par exemple `app.listen(3001)`.
Pour savoir quel programme l'occupe : `lsof -i :3000` (Linux/macOS) ou
`netstat -ano | findstr :3000` (Windows).

## À la connexion

### Toujours `401 INVALID_CREDENTIALS` avec le bon mot de passe

Vérifiez dans l'ordre :

1. **Normalisation de l'identifiant** : `findByIdentifier()` doit appliquer la même
   transformation (minuscules, `trim()`) que lors de l'inscription.
2. **`isActive`** doit valoir exactement `true` (pas `1`, ni `"true"`). Une autre valeur
   que `true`/`false` lève d'ailleurs une `ContractViolationError`.
3. **Le hash** : il doit avoir été produit par `auth.password.hash()` (commence par `$argon2id$`).
4. Journalisez `error.reason` côté serveur pour connaître la cause exacte
   (`USER_NOT_FOUND`, `INVALID_PASSWORD`, `ACCOUNT_DISABLED`).

### `400 INVALID_INPUT` : `Request body must be a JSON object…`

Le corps de la requête n'a pas été lu. Vérifiez les deux côtés :

- serveur : `express.json()` doit être placé **avant** `expressAuth.login()`
  (`app.post("/login", express.json(), expressAuth.login())`) ;
- client : l'en-tête `Content-Type: application/json` doit être envoyé.

### `400 INVALID_INPUT` : `` `identifier` must be a non-empty string ``

Le champ attendu est absent du corps JSON. Si votre formulaire envoie `email`, configurez
`expressAuth.login({ identifierField: "email" })`.

### Erreur 500 et `InvalidPasswordHashError`

Le hash stocké n'est pas au format Argon2id (bcrypt, SHA-256, texte brut…). Voir
[migration depuis bcrypt](providers-personnalises.md#exemple--migration-depuis-bcrypt).

### Erreur 500 et `ContractViolationError` pendant une requête

Le repository renvoie un objet mal formé ; le message indique la correction. Causes
fréquentes : `passwordHash` absent (champ exclu par `select`), `isActive` absent (renvoyez
`isActive: true` si vos comptes ne peuvent pas être désactivés), `id` d'un type non pris en
charge (seuls chaîne, entier, `BigInt` et `ObjectId` sont acceptés). Corrigez la conversion dans le repository
(voir [mettre en correspondance un modèle existant](repository-utilisateur.md#mettre-en-correspondance-un-modèle-existant)).

### La connexion est lente (plusieurs centaines de ms)

C'est voulu : Argon2id est volontairement coûteux. Ajustez les
[paramètres](configuration.md#configuration-argon2id) à votre matériel, sans descendre sous
le minimum. Dans les tests automatisés, utilisez le minimum accepté
(`{ memoryCost: 19456, timeCost: 2, parallelism: 1 }`).

## Sur les routes protégées

### `401 TOKEN_MISSING` alors que le token est envoyé

- L'en-tête doit être `Authorization: Bearer <token>` (un espace, pas de guillemets).
- Un proxy ou une configuration CORS peut supprimer l'en-tête `Authorization` :
  ajoutez-le à `Access-Control-Allow-Headers`.

### `401 TOKEN_INVALID` juste après la connexion

- Les instances ne partagent pas le même `AUTH_SECRET`, `issuer` ou `audience`.
- L'utilisateur a été désactivé ou supprimé, ou `findById()` ne retrouve pas l'utilisateur
  à partir de l'`id` reçu **en chaîne** (pour une clé entière avec Prisma, utilisez `Number(id)`).
- L'horloge du serveur est en retard (`iat` dans le futur) : synchronisez-la (NTP) ou
  réglez `jwt.clockToleranceSeconds` (60 s maximum).

### `401 TOKEN_EXPIRED`

Le token a dépassé `expiresInSeconds`. Le client doit se reconnecter (les refresh tokens ne
sont pas disponibles en 0.1.0).

### `req.auth` est `undefined`

La route n'utilise pas `expressAuth.authenticate()`, ou le middleware est placé après le
gestionnaire de la route.

### Tous les utilisateurs partagent la même limite de tentatives

L'application est derrière un proxy et `trust proxy` n'est pas configuré : `req.ip` est l'IP
du proxy. Voir [limitation des tentatives](securite.md#limitation-des-tentatives-de-connexion).

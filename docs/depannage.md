# Dépannage et erreurs courantes

**En bref** : cette page aide à résoudre les problèmes les plus fréquents. Cherchez votre
symptôme (souvent un message d'erreur) dans la bonne section : au démarrage, à la connexion ou
sur les routes protégées. Pour chaque cas, vous trouverez la cause probable et la solution.

Rappel : **401** signifie « non authentifié », **400** signifie « requête mal formée ».
Le `code` de l'erreur (`INVALID_CREDENTIALS`, `TOKEN_MISSING`…) est dans la réponse JSON.

## Au démarrage

### ``ConfigurationError: `jwt.secret` is required.``

- **Cause probable** : `process.env.AUTH_SECRET` est vide. Le fichier `.env` n'est pas chargé.
- **Solution** : chargez le fichier `.env` au lancement :

  ```bash
  node --env-file=.env server.js   # Node.js 22+, sans dépendance
  ```

  Ou définissez la variable dans votre environnement d'exécution (Docker, systemd, CI…).

### `` `jwt.secret` must be at least 32 bytes long `` / `looks like a placeholder value` / `is too repetitive`

- **Cause probable** : le secret est trop court, ou ressemble à une valeur d'exemple copiée
  d'un tutoriel.
- **Solution** : générez un nouveau secret et mettez-le dans `AUTH_SECRET` :

  ```bash
  npx express-authkit secret
  ```

  Avec `HS384`, il faut au moins 48 octets. Avec `HS512`, au moins 64.

### ``Unknown option(s) in `jwt`: expiresIn``

- **Cause probable** : le nom de l'option est faux.
- **Solution** : utilisez `expiresInSeconds`, avec un nombre entier (`900`, pas `"15m"`).
  Le message affiche la liste des options autorisées.

### `ContractViolationError: UserRepository must implement: findById().`

- **Cause probable** : votre objet `users` n'a pas les deux méthodes `findByIdentifier()` et
  `findById()`.
- **Solution** : ajoutez la méthode manquante. Si vous utilisez une classe, passez une
  **instance** (`new UserRepository()`), pas la classe elle-même.

### ``Use either `jwt` options or `providers.token`, not both.``

- **Cause probable** : vous utilisez un provider de token personnalisé **et** l'option `jwt`.
- **Solution** : supprimez l'option `jwt`.

### `SyntaxError: Cannot use import statement outside a module`

- **Cause probable** : votre projet est en CommonJS (`require`). La bibliothèque utilise
  `import`.
- **Solution** : ajoutez `"type": "module"` à votre `package.json` (`npm pkg set type=module`),
  ou renommez vos fichiers en `.mjs`.

### `ERR_PACKAGE_PATH_NOT_EXPORTED`

- **Cause probable** : vous importez un fichier interne (`express-authkit/src/...`).
- **Solution** : importez uniquement depuis `express-authkit` et `express-authkit/express`.

### L'installation de `argon2` échoue

- **Cause probable** : `argon2` est un module natif (compilé pour chaque système). Il manque
  un binaire pour votre plateforme, ou npm a bloqué son script d'installation.
- **Solution** : vérifiez d'abord qu'il se charge :
  `node -e "import('argon2').then(() => console.log('ok'))"`.
  S'il échoue, voir [Installer `argon2`](#installer-argon2) plus bas.

### `EADDRINUSE`, ou une page HTML inattendue sur `localhost:3000`

- **Cause probable** : un autre programme utilise déjà le port 3000 (conteneur Docker, autre
  serveur de développement).
- **Solution** : changez le port, par exemple `app.listen(3001)`.
  Pour trouver le programme qui l'occupe : `lsof -i :3000` (Linux/macOS) ou
  `netstat -ano | findstr :3000` (Windows).

## À la connexion

### Toujours `401 INVALID_CREDENTIALS`, même avec le bon mot de passe

- **Cause probable** : l'utilisateur n'est pas trouvé, le hash n'est pas le bon, ou le compte
  est considéré comme désactivé.
- **Solution** : vérifiez dans l'ordre :
  1. **L'identifiant** : `findByIdentifier()` doit le transformer comme à l'inscription
     (minuscules, `trim()`).
  2. **`isActive`** doit valoir exactement `true` (pas `1`, ni `"true"`). Une valeur qui n'est
     ni `true` ni `false` lève d'ailleurs une `ContractViolationError`.
  3. **Le hash** doit venir de `auth.password.hash()`. Il commence par `$argon2id$`.
  4. Journalisez `error.reason` **côté serveur** pour connaître la cause exacte
     (`USER_NOT_FOUND`, `INVALID_PASSWORD`, `ACCOUNT_DISABLED`). Ne l'envoyez jamais au client
     (voir [erreurs](erreurs.md#journaliser-les-échecs-de-connexion)).

### `400 INVALID_INPUT` : `Request body must be a JSON object…`

- **Cause probable** : le serveur n'a pas lu le corps de la requête.
- **Solution** : vérifiez les deux côtés :
  1. Serveur : `express.json()` doit être placé **avant** `expressAuth.login()`
     (`app.post("/login", express.json(), expressAuth.login())`).
  2. Client : il doit envoyer l'en-tête `Content-Type: application/json`.

### `400 INVALID_INPUT` : `` `identifier` must be a non-empty string ``

- **Cause probable** : le champ attendu est absent du corps JSON. Par défaut, ce champ
  s'appelle `identifier`.
- **Solution** : si votre formulaire envoie `email`, configurez
  `expressAuth.login({ identifierField: "email" })`. Le message cite toujours `identifier`,
  même avec un autre nom de champ.

### Erreur 500 avec `InvalidPasswordHashError`

- **Cause probable** : le hash stocké n'est pas au format Argon2id (bcrypt, SHA-256, texte
  brut…).
- **Solution** : voir [migration depuis bcrypt](providers-personnalises.md#exemple--migration-depuis-bcrypt).

### Erreur 500 avec `ContractViolationError` pendant une requête

- **Cause probable** : votre repository renvoie un objet mal formé. Cas fréquents :
  - `passwordHash` absent (champ exclu par `select`) ;
  - `isActive` absent : renvoyez `isActive: true` si vos comptes ne peuvent pas être
    désactivés ;
  - `id` d'un type non pris en charge (seuls chaîne, entier, `BigInt` et `ObjectId` sont
    acceptés).
- **Solution** : lisez le message, il indique la correction. Corrigez la conversion dans le
  repository (voir [mettre en correspondance un modèle existant](repository-utilisateur.md#mettre-en-correspondance-un-modèle-existant)).

### La connexion est lente (plusieurs centaines de ms)

- **Cause probable** : c'est voulu. Argon2id est volontairement lent, pour freiner les
  attaquants qui voleraient vos hashs.
- **Solution** : ajustez les [paramètres](configuration.md#configuration-argon2id) à votre
  matériel, sans descendre sous le minimum. Dans les tests automatisés, utilisez le minimum
  accepté (`{ memoryCost: 19456, timeCost: 2, parallelism: 1 }`).

## Sur les routes protégées

### `401 TOKEN_MISSING` alors que le token est envoyé

- **Cause probable** : l'en-tête n'arrive pas au serveur, ou n'utilise pas le mot `Bearer`.
- **Solution** :
  1. Écrivez l'en-tête exactement ainsi : `Authorization: Bearer <token>`.
  2. Un proxy ou une configuration CORS peut supprimer l'en-tête `Authorization`. Ajoutez-le
     à `Access-Control-Allow-Headers`.

### `401 TOKEN_INVALID` juste après la connexion

- **Cause probable** et **solution**, selon le cas :
  - **Valeur mal écrite** après `Bearer` (guillemets, caractères en trop) : envoyez
    `Bearer`, un espace, puis le token brut.
  - **Plusieurs serveurs** qui ne partagent pas le même `AUTH_SECRET`, `issuer` ou `audience` :
    utilisez les mêmes valeurs partout.
  - **Utilisateur introuvable** : il a été désactivé ou supprimé, ou `findById()` ne le
    retrouve pas car l'`id` arrive **en chaîne**. Pour une clé entière avec Prisma, utilisez
    `Number(id)`.
  - **Horloge du serveur en retard** (`iat` dans le futur) : synchronisez-la (NTP), ou réglez
    `jwt.clockToleranceSeconds` (60 s maximum).

### `401 TOKEN_EXPIRED`

- **Cause probable** : le token a dépassé sa durée de vie (`expiresInSeconds`).
- **Solution** : le client doit se reconnecter. Les refresh tokens (renouvellement
  automatique) ne sont pas disponibles en 0.1.0.

### `req.auth` vaut `undefined`

- **Cause probable** : la route n'utilise pas `expressAuth.authenticate()`, ou le middleware
  est placé après le gestionnaire de la route.
- **Solution** : placez `expressAuth.authenticate()` avant votre gestionnaire :
  `app.get("/profile", expressAuth.authenticate(), handler)`.

### Tous les utilisateurs partagent la même limite de tentatives

- **Cause probable** : l'application est derrière un proxy et `trust proxy` n'est pas configuré.
  `req.ip` contient alors l'adresse du proxy, la même pour tout le monde.
- **Solution** : voir [limitation des tentatives](securite.md#limitation-des-tentatives-de-connexion).

## Pour aller plus loin

### Installer `argon2`

`argon2` est livré avec des binaires précompilés pour les plateformes courantes (Linux
glibc/musl, macOS, Windows ; x64 et arm64).

- **npm 11 et les scripts d'installation** : npm peut afficher
  `package has install scripts not yet covered by allowScripts`. Les binaires précompilés sont
  en général utilisés quand même. Vérifiez avec
  `node -e "import('argon2').then(() => console.log('ok'))"`. Si le chargement échoue,
  autorisez le script : `npm approve-scripts argon2`.
- **Plateforme sans binaire précompilé** : installez une chaîne de compilation
  (`python3`, `make`, `g++` ; sur Alpine : `apk add --no-cache python3 make g++`).
- **Docker** : installez les dépendances **dans** l'image (`npm ci` dans le `Dockerfile`).
  Ne copiez pas un `node_modules` construit sur une autre plateforme.

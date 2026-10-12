# Sécurité : bonnes pratiques et limites

**En bref** : Express AuthKit applique des réglages sûrs par défaut, mais il ne peut pas tout
faire à votre place. Cette page liste ce que la bibliothèque fait déjà, ce que vous devez faire
vous-même et ses limites connues. Après lecture, vous saurez préparer votre API pour la
production.

## Avant la mise en production

Cochez chaque point. Chacun est expliqué plus bas.

- [ ] L'API est servie **uniquement en HTTPS**, avec HSTS activé ([détails](#https-obligatoire)).
- [ ] La route de connexion **limite le nombre de tentatives** ([détails](#limitation-des-tentatives-de-connexion)).
- [ ] Le secret JWT est généré avec `npx express-authkit secret` et n'est jamais commité ([détails](#rotation-du-secret)).
- [ ] La durée de vie des tokens reste **courte** (15 minutes par défaut) ([détails](#révocation-des-jwt)).
- [ ] Vous savez **couper l'accès** d'un utilisateur : désactiver son compte ([détails](#révocation-des-jwt)).
- [ ] Les routes sensibles (administration…) sont protégées par `authorize()`, pas seulement par `authenticate()` ([rôles et permissions](roles-et-permissions.md)).
- [ ] Les logs ne contiennent **ni mot de passe, ni token, ni en-tête `Authorization`** ([détails](#journalisation)).
- [ ] Les en-têtes HTTP sont durcis : `helmet`, limite de taille JSON, CORS, `no-store` ([détails](#en-têtes-et-durcissement-http)).
- [ ] Le client stocke le token de façon prudente ([détails](#stockage-du-token-côté-client)).
- [ ] Vous avez lu les [limites connues](#limites-connues).

## Ce que la bibliothèque fait pour vous

| Protection | En pratique | Testé dans |
| --- | --- | --- |
| Hachage Argon2id (algorithme volontairement lent, pour rendre le cassage coûteux) | Paramètres au moins égaux au minimum OWASP, sel aléatoire, comparaison en temps constant. | `tests/unit/argon2-password-provider.test.js` |
| Secret JWT exigé | Obligatoire, au moins 32 octets (HS256). Les valeurs d'exemple et répétitives sont refusées. | `tests/unit/config.test.js` |
| Algorithmes JWT | Liste fermée. `alg: none` et tout autre algorithme sont refusés. | `tests/security/jwt-security.test.js` |
| Contenu du JWT vérifié | `iss`, `aud`, `exp`, `iat`, `sub`, `jti` et `typ: at+jwt` sont contrôlés. | `tests/security/jwt-security.test.js` |
| Tokens falsifiés, expirés ou mal formés | Refusés avec une réponse 401. | `tests/security/`, `tests/integration/express.test.js` |
| Pas de données personnelles dans le token | Le JWT contient uniquement des champs standard. | `tests/security/jwt-security.test.js` |
| Pas d'énumération de comptes | Même erreur pour un compte inconnu, un mauvais mot de passe ou un compte désactivé. Un attaquant ne peut donc pas savoir si un e-mail est inscrit. | `tests/security/login-security.test.js` |
| Temps de réponse égalisé | Pour un compte inexistant, un vrai calcul Argon2id est fait sur un hash factice. La réponse prend donc à peu près le même temps. | `tests/security/login-security.test.js` |
| Comptes désactivés ou supprimés | Refusés à la connexion **et** à chaque requête authentifiée. | `tests/security/login-security.test.js` |
| Rôles et permissions | Relus à chaque requête, jamais dans le JWT ; `req.auth` posé par un autre middleware ignoré ; une règle `check` défaillante refuse l'accès. | `tests/security/authorization.test.js` |
| Hash du mot de passe protégé | Jamais renvoyé par `login()`, jamais placé dans `req.auth`. | `tests/unit/authentication-service.test.js` |
| Entrées vérifiées | Types et longueurs contrôlés avant tout calcul coûteux. | `tests/unit/authentication-service.test.js` |
| Erreurs HTTP sobres | Seuls un code et un message public sont envoyés. Jamais la pile d'appels, la cause ni la raison interne. | `tests/integration/express.test.js` |
| Aucun log | La bibliothèque n'écrit rien dans la console. | `tests/unit/architecture.test.js` |

## Ce que vous devez faire vous-même

### HTTPS obligatoire

Après la connexion, le client reçoit un **JWT** (JSON Web Token) : une chaîne signée qui
prouve son identité. Il le renvoie à chaque requête dans l'en-tête
`Authorization: Bearer <token>`. « Bearer » veut dire « porteur » : quiconque possède le
token est considéré comme l'utilisateur.

Un token intercepté donne donc accès au compte jusqu'à son expiration. Servez l'API
**uniquement en HTTPS**. Activez aussi **HSTS** sur votre reverse proxy (le serveur placé
devant Node.js, comme Nginx). HSTS oblige le navigateur à toujours utiliser HTTPS.

### Limitation des tentatives de connexion

Le **rate limiting** consiste à limiter le nombre de requêtes qu'un client peut faire sur une
période. La bibliothèque ne le fait pas, car cela dépend de votre infrastructure.

**C'est pourtant indispensable.** Sans limite :

- un attaquant peut essayer des milliers de mots de passe (attaque par **force brute**) ;
- comme Argon2id est volontairement coûteux, il peut aussi saturer le processeur du serveur.

Nous recommandons deux limiteurs (politique inspirée de l'OWASP) :

| Limiteur | Ce qui est compté | Seuil indicatif | Rôle |
| --- | --- | --- | --- |
| Par IP | adresse IP (IPv6 regroupée par /56) | 20 tentatives / 15 min | freine une machine qui teste beaucoup de comptes |
| Par identifiant | hash SHA-256 de l'identifiant normalisé | 5 échecs / 15 min | freine une attaque sur un compte depuis de nombreuses IP |

L'exemple ci-dessous utilise [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit).
Les compteurs sont stockés dans **Redis** (une base clé-valeur en mémoire). Ainsi, toutes les
instances de votre application partagent les mêmes compteurs. Une version testée de ce code
se trouve dans [examples/basic-express/src/rate-limit.js](../examples/basic-express/src/rate-limit.js).

```bash
npm install express-rate-limit rate-limit-redis redis
```

```javascript
import { createHash } from "node:crypto";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// Un store distinct par limiteur (express-rate-limit l'exige), partagé par toutes les instances.
const redisStore = (prefix) =>
  new RedisStore({ sendCommand: (...args) => redis.sendCommand(args), prefix: `rl:${prefix}` });

const tooManyAttempts = (req, res, next, options) =>
  res.status(options.statusCode).json({
    error: { code: "TOO_MANY_REQUESTS", message: "Trop de tentatives de connexion. Réessayez plus tard." }
  });

const loginLimiterByIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: tooManyAttempts,
  store: redisStore("login-ip:")
});

const loginLimiterByIdentifier = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true, // seuls les échecs comptent
  standardHeaders: "draft-8",
  legacyHeaders: false,
  // L'identifiant est haché : aucune adresse e-mail n'est stockée dans Redis.
  keyGenerator: (req) =>
    createHash("sha256")
      .update(String(req.body?.identifier ?? "").trim().toLowerCase())
      .digest("base64url"),
  handler: tooManyAttempts,
  store: redisStore("login-id:")
});

app.set("trust proxy", 1); // nombre exact de proxys devant l'application
app.use(express.json({ limit: "10kb" }));
app.post("/auth/login", loginLimiterByIp, loginLimiterByIdentifier, loginHandler);
```

Ici, `loginHandler` est votre gestionnaire de connexion, par exemple `expressAuth.login()`.

Points d'attention :

- **`trust proxy`** : derrière un load balancer ou un reverse proxy, indiquez le nombre
  exact de proxys. Sinon, `req.ip` vaut l'IP du proxy, et tout le monde partage le même
  compteur. À l'inverse, la valeur `true` est trop permissive : un client peut alors
  falsifier son IP avec l'en-tête `X-Forwarded-For`.
- **Sans Redis** : chaque instance garde ses propres compteurs en mémoire. Avec 4 instances,
  la limite réelle est donc multipliée par 4.
- **Nom du champ** : le limiteur par identifiant lit `req.body.identifier`. Si vous utilisez
  `expressAuth.login({ identifierField: "email" })`, lisez `req.body.email` à la place.
- **Blocage d'une victime** : le limiteur par identifiant permet à un attaquant de bloquer
  temporairement la connexion d'une personne dont il connaît l'identifiant. C'est un
  compromis assumé. Ajustez le seuil et la fenêtre, ou remplacez le blocage par un CAPTCHA.

### Révocation des JWT

**Révoquer** un token, c'est le rendre inutilisable avant sa date d'expiration.

Un JWT est **sans état** : le serveur ne garde aucune liste des tokens émis. Il vérifie
seulement la signature et la date. Un token reste donc valide jusqu'à son expiration
(`exp`), même si l'utilisateur se déconnecte.

Express AuthKit réduit ce problème : à chaque requête, il relit l'utilisateur avec
`findById()`. Voici ce qui se passe dans chaque situation :

| Situation | Le token est-il refusé tout de suite ? | Pourquoi |
| --- | --- | --- |
| Compte désactivé (`isActive: false`) | **Oui** | `findById()` est appelé à chaque requête. |
| Compte supprimé | **Oui** | `findById()` renvoie `null`. |
| Changement de mot de passe | **Non** pour le token d'accès (15 min au plus) | Appelez `auth.revokeAllSessions(userId)` : les refresh tokens sont révoqués tout de suite. |
| Déconnexion (« logout ») | **Non** pour le token d'accès (15 min au plus) | Avec les [refresh tokens](refresh-tokens.md), `auth.logout()` révoque la session : plus aucun nouveau token. |
| Token volé | **Non** | Il reste valide jusqu'à expiration, sauf si vous désactivez le compte. |
| Fuite du secret | **Oui, pour tous** | Changez `AUTH_SECRET` : tous les tokens deviennent invalides. |

Ce que nous recommandons :

- Gardez une **durée de vie courte** : 15 minutes par défaut, 24 heures au maximum.
- Pour couper l'accès d'un utilisateur, **désactivez temporairement son compte**.
- Vous pouvez aussi ajouter une règle dans votre repository. Par exemple, renvoyer
  `isActive: false` tant qu'un drapeau de sécurité est levé sur le compte.
- Activez les [refresh tokens](refresh-tokens.md) : le token d'accès peut rester court
  (15 minutes) sans que l'utilisateur doive se reconnecter, et la déconnexion devient réelle.
- Une liste de révocation par `jti` (l'identifiant unique de chaque token d'accès) n'est
  **pas disponible** en 0.1.0. C'est un
  [point d'extension futur](architecture.md#points-dextension-futurs).

### Rotation du secret

Le **secret** est la clé qui signe les JWT. Celui qui le connaît peut fabriquer des tokens
valides. La **rotation** consiste à le remplacer par un nouveau.

- Générez le secret avec `npx express-authkit secret`. Gardez-le dans une variable
  d'environnement (`AUTH_SECRET`), jamais dans le code.
- La version 0.1.0 accepte **un seul** secret à la fois.
- Changer `AUTH_SECRET` invalide immédiatement **tous** les tokens. Tous les utilisateurs
  doivent se reconnecter. Planifiez la rotation en conséquence.
- Une rotation sans coupure (plusieurs clés en parallèle, identifiées par `kid`) est un
  point d'extension futur.

### Journalisation

- Ne journalisez jamais `req.body` sur les routes `/auth/*`. Il contient le mot de passe.
- Ne journalisez jamais l'en-tête `Authorization`, ni aucun token.
- Configurez votre logger HTTP pour masquer ces champs (par exemple l'option `redact` de pino).
- Journalisez les échecs de connexion côté serveur avec `error.reason`. Évitez d'y mettre
  l'identifiant en clair si possible (voir [erreurs](erreurs.md#journaliser-les-échecs-de-connexion)).

### En-têtes et durcissement HTTP

- Masquez l'en-tête `X-Powered-By` avec `app.disable("x-powered-by")`, ou utilisez
  [`helmet`](https://www.npmjs.com/package/helmet).
- Limitez la taille des corps JSON : `express.json({ limit: "10kb" })`.
- Envoyez `Cache-Control: no-store` sur toute réponse qui contient un token. Ainsi, aucun
  cache ne le conserve. L'adaptateur le fait déjà pour ses réponses d'erreur et pour la
  réponse de `expressAuth.login()`. Si vous écrivez votre propre route de connexion avec
  `auth.login()`, ajoutez-le vous-même.
- Configurez **CORS** (les règles qui disent quels sites web peuvent appeler votre API)
  avec une liste explicite d'origines.

### Stockage du token côté client

- L'adaptateur 0.1.0 lit le token **uniquement** dans l'en-tête `Authorization`.
- Côté client, gardez le token **en mémoire** quand c'est possible.
- Évitez `localStorage` : n'importe quel script injecté dans la page peut le lire (attaque
  **XSS**, pour *cross-site scripting*).
- Les cookies `HttpOnly` (illisibles par JavaScript) ne sont pas gérés en 0.1.0.

## Limites connues

- **Pas de limitation intégrée des tentatives.** C'est à votre application de la mettre en
  place (voir [plus haut](#limitation-des-tentatives-de-connexion)).
- **Égalisation du temps de réponse partielle.** Le coût d'Argon2id est le même pour un
  compte inexistant, un mauvais mot de passe et un compte désactivé. Mais les écarts propres
  à votre repository ne sont pas masqués (par exemple une requête SQL plus lente quand
  l'utilisateur existe). De plus, la première tentative sur un compte inexistant calcule
  aussi le hash factice (une seule fois par processus), ce qui la rend plus lente.
- **Détection des secrets faibles approximative.** Elle repère les erreurs courantes, mais
  ne remplace pas un secret généré aléatoirement.
- **HMAC uniquement.** Avec **HMAC**, la même clé sert à signer et à vérifier. Tout service
  qui vérifie les tokens peut donc aussi en fabriquer. Avec une **clé asymétrique**, une clé
  privée signe et une clé publique vérifie. Pour des vérificateurs tiers, il vous faut un
  [provider asymétrique](providers-personnalises.md) que vous écrivez vous-même.
- **Un seul secret.** Pas de rotation sans déconnecter les utilisateurs.
- **Révocation limitée.** Voir le [tableau de révocation](#révocation-des-jwt).
- **Une lecture en base par requête.** `verifyAccessToken()` appelle `findById()` à chaque
  requête authentifiée. Gardez un index sur la clé primaire (c'est le cas par défaut) et
  dimensionnez votre base en conséquence.
- **Pas d'audit externe.** La version 0.1.0 n'a pas été auditée par un expert indépendant.
  Les garanties de cette page sont seulement celles couvertes par les tests automatisés.

## Pour aller plus loin

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [RFC 8725 — JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)
- [RFC 9106 — Argon2](https://www.rfc-editor.org/rfc/rfc9106)
- [RFC 6750 — Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)

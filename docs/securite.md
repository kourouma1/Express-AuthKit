# Bonnes pratiques et limites de sécurité

Express AuthKit applique des réglages sûrs par défaut, mais **la sécurité d'une API dépend
aussi de son déploiement**. Ce document liste ce que la bibliothèque garantit, ce qui reste à
votre charge et les limites connues.

## Ce que la bibliothèque applique

| Mesure | Détail | Testé dans |
| --- | --- | --- |
| Argon2id | Paramètres ≥ plancher OWASP, sel aléatoire, comparaison en temps constant | `tests/unit/argon2-password-provider.test.js` |
| Secret JWT | Obligatoire, ≥ 32 octets (HS256), valeurs d'exemple et répétitives refusées | `tests/unit/config.test.js` |
| Algorithmes JWT | Liste fermée ; `alg: none` et autres algorithmes refusés | `tests/security/jwt-security.test.js` |
| Claims JWT | `iss`, `aud`, `exp`, `iat`, `sub`, `jti` et `typ: at+jwt` vérifiés | `tests/security/jwt-security.test.js` |
| Tokens falsifiés / expirés / mal formés | Refusés (401) | `tests/security/`, `tests/integration/express.test.js` |
| Contenu des tokens | Uniquement des claims standard, aucune donnée personnelle | `tests/security/jwt-security.test.js` |
| Énumération de comptes | Même erreur publique pour compte inconnu, mot de passe faux, compte désactivé | `tests/security/login-security.test.js` |
| Écart temporel | Vérification Argon2id réelle sur un hash factice pour les comptes inexistants | `tests/security/login-security.test.js` |
| Comptes désactivés / supprimés | Refusés à la connexion **et** à chaque requête authentifiée | `tests/security/login-security.test.js` |
| Hash de mot de passe | Jamais renvoyé par `login()` ni placé dans `req.auth` | `tests/unit/authentication-service.test.js` |
| Entrées non fiables | Types et longueurs vérifiés avant tout traitement coûteux | `tests/unit/authentication-service.test.js` |
| Erreurs HTTP | Code + message public uniquement ; pas de pile, cause ni raison interne | `tests/integration/express.test.js` |
| Journalisation | La bibliothèque n'écrit rien dans la console | `tests/unit/architecture.test.js` |

## Ce qui reste à votre charge

### HTTPS obligatoire

Un token `Bearer` intercepté donne accès au compte jusqu'à son expiration. Servez l'API
uniquement en HTTPS et activez HSTS sur votre reverse proxy.

### Limitation des tentatives de connexion

La bibliothèque ne limite pas le nombre de tentatives : cette politique dépend de votre
infrastructure. **Elle est indispensable** : sans elle, la route de connexion permet la
force brute, et le coût d'Argon2id peut être utilisé pour saturer le CPU.

Politique recommandée (inspirée de l'OWASP) :

| Limiteur | Clé | Seuil indicatif | Rôle |
| --- | --- | --- | --- |
| Par IP | adresse IP (IPv6 regroupée par /56) | 20 tentatives / 15 min | freine une machine qui teste beaucoup de comptes |
| Par identifiant | hash SHA-256 de l'identifiant normalisé | 5 échecs / 15 min | freine les attaques réparties sur de nombreuses IP |

Exemple complet avec [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit),
compatible avec plusieurs instances grâce à un store Redis partagé
(code testé dans [examples/basic-express/src/rate-limit.js](../examples/basic-express/src/rate-limit.js)) :

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
    error: { code: "TOO_MANY_REQUESTS", message: "Too many login attempts. Try again later." }
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

Points d'attention :

- **`trust proxy`** : derrière un load balancer, réglez-le sur le nombre exact de proxys,
  sinon `req.ip` est l'IP du proxy (tout le monde partage le même compteur) ou peut être
  falsifiée via `X-Forwarded-For` (valeur `true` trop permissive).
- **Store en mémoire** : sans Redis, chaque instance a ses propres compteurs ; la limite
  effective est multipliée par le nombre d'instances.
- **Limiteur par identifiant** : il permet à un attaquant de bloquer temporairement la
  connexion d'une victime dont il connaît l'identifiant. C'est un compromis assumé ;
  ajustez le seuil et la fenêtre, ou remplacez le blocage par un CAPTCHA.

### Révocation des JWT

Un JWT d'accès est **sans état** : il reste cryptographiquement valide jusqu'à `exp`.
Express AuthKit atténue cette limite ainsi :

| Situation | Effet immédiat ? | Mécanisme |
| --- | --- | --- |
| Compte désactivé (`isActive: false`) | **Oui** | `findById()` à chaque requête |
| Compte supprimé | **Oui** | `findById()` renvoie `null` |
| Changement de mot de passe | **Non** | les tokens existants restent valides jusqu'à expiration |
| Déconnexion (« logout ») | **Non** | le client supprime son token ; il reste valide jusqu'à expiration |
| Token volé | **Non** | valide jusqu'à expiration, sauf désactivation du compte |
| Fuite du secret | **Oui, pour tous** | changez `AUTH_SECRET` : tous les tokens deviennent invalides |

Recommandations :

- gardez une **durée de vie courte** (15 minutes par défaut, 24 h maximum) ;
- pour invalider tous les tokens d'un utilisateur, désactivez temporairement le compte, ou
  implémentez dans votre repository une règle supplémentaire (par exemple renvoyer
  `isActive: false` tant qu'un drapeau de sécurité est levé) ;
- une liste de révocation par `jti` et les refresh tokens sont des
  [points d'extension futurs](architecture.md#points-dextension-futurs), non disponibles en 0.1.0.

### Rotation du secret

La version 0.1.0 accepte **un seul** secret. Changer `AUTH_SECRET` invalide immédiatement
tous les tokens émis (les utilisateurs doivent se reconnecter). Planifiez la rotation en
conséquence ; la rotation sans coupure (plusieurs clés, `kid`) est un point d'extension.

### Journalisation

- Ne journalisez jamais `req.body` sur `/auth/*`, ni l'en-tête `Authorization`, ni les tokens.
- Configurez votre logger HTTP pour masquer ces champs (par exemple l'option `redact` de pino).
- Journalisez les échecs avec `error.reason` côté serveur, sans l'identifiant en clair si
  possible (voir [erreurs](erreurs.md#journaliser-les-échecs-de-connexion)).

### En-têtes et durcissement HTTP

- `app.disable("x-powered-by")` ou [`helmet`](https://www.npmjs.com/package/helmet).
- Limitez la taille des corps JSON : `express.json({ limit: "10kb" })`.
- `Cache-Control: no-store` sur les réponses contenant un token (fait automatiquement pour
  les erreurs par l'adaptateur ; à ajouter sur votre réponse de connexion).
- Configurez CORS avec une liste explicite d'origines.

### Stockage du token côté client

L'adaptateur 0.1.0 lit uniquement l'en-tête `Authorization`. Conservez le token en mémoire
quand c'est possible ; `localStorage` est accessible à tout script injecté (XSS). La gestion
des cookies `HttpOnly` n'est pas fournie en 0.1.0.

## Limites connues

- **Pas de limitation intégrée des tentatives** : à mettre en place par l'application (voir ci-dessus).
- **Atténuation temporelle partielle** : elle égalise le coût Argon2id entre compte inexistant,
  mot de passe faux et compte désactivé. Elle ne masque pas les écarts propres à votre
  repository (par exemple une requête plus lente quand l'utilisateur existe). Le premier
  appel pour un compte inexistant calcule en plus le hash factice (une fois par processus).
- **Détection heuristique des secrets faibles** : ne remplace pas une génération aléatoire.
- **HMAC uniquement** : tous les services qui vérifient les tokens détiennent aussi la clé
  permettant d'en émettre. Pour des vérificateurs tiers, il faudra un provider asymétrique.
- **Un seul secret** : pas de rotation sans déconnexion des utilisateurs.
- **Révocation** : voir le tableau ci-dessus.
- **Coût par requête** : `verifyAccessToken()` appelle `findById()` à chaque requête
  authentifiée ; prévoyez un index sur la clé primaire (c'est le cas par défaut) et
  dimensionnez votre base en conséquence.
- **Pas d'audit externe** : la version 0.1.0 n'a pas fait l'objet d'un audit de sécurité
  indépendant. Les garanties ci-dessus sont celles couvertes par les tests automatisés.

## Références

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [RFC 8725 — JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)
- [RFC 9106 — Argon2](https://www.rfc-editor.org/rfc/rfc9106)
- [RFC 6750 — Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)

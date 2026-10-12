# Configuration

Toute la configuration passe par `createAuthKit(options)`. Elle est **validée immédiatement** :
une option manquante, inconnue ou dangereuse lève une `ConfigurationError` au démarrage de
l'application, jamais pendant une requête.

```javascript
import { createAuthKit } from "express-authkit";

const auth = createAuthKit({
  users: userRepository,            // obligatoire : votre repository utilisateur
  jwt: {                            // obligatoire (sauf provider de token personnalisé)
    secret: process.env.AUTH_SECRET,
    issuer: "my-api",
    audience: "my-client",
    expiresInSeconds: 900,          // facultatif, 900 par défaut
    algorithm: "HS256",             // facultatif, HS256 par défaut
    clockToleranceSeconds: 0        // facultatif, 0 par défaut
  },
  password: {                       // facultatif : coûts Argon2id
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  }
});
```

Les options de premier niveau acceptées sont `users`, `jwt`, `password` et `providers`
([providers personnalisés](providers-personnalises.md)). Toute autre clé est refusée,
afin qu'une faute de frappe (`expiresIn` au lieu de `expiresInSeconds`) ne passe pas inaperçue.

## Configuration JWT

| Option | Type | Défaut | Règle |
| --- | --- | --- | --- |
| `secret` | `string` ou `Uint8Array` | — | Obligatoire. ≥ 32 octets (HS256), ≥ 48 (HS384), ≥ 64 (HS512). Refusé s'il ressemble à une valeur d'exemple ou s'il est trop répétitif. |
| `issuer` | `string` | — | Obligatoire, non vide, ≤ 256 caractères. Écrit dans `iss` et vérifié. |
| `audience` | `string` | — | Obligatoire, non vide, ≤ 256 caractères. Écrit dans `aud` et vérifié. |
| `expiresInSeconds` | entier | `900` | Entre 30 et 86 400 (24 h). |
| `algorithm` | `"HS256"`, `"HS384"`, `"HS512"` | `"HS256"` | Seul algorithme accepté à la vérification. |
| `clockToleranceSeconds` | entier | `0` | Entre 0 et 60. Décalage d'horloge toléré entre serveurs. |

### Générer le secret

Le secret doit provenir d'un générateur aléatoire cryptographiquement sûr, **jamais** d'un
mot ou d'une phrase choisis à la main :

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Stockez-le dans une variable d'environnement (`AUTH_SECRET`) ou un gestionnaire de secrets
(Vault, AWS Secrets Manager, GCP Secret Manager…). Ne le commitez jamais. Toutes les instances
de l'API doivent utiliser **le même** secret.

> La détection des secrets faibles est une **heuristique** : elle refuse les erreurs
> courantes (valeur trop courte, `changeme`, `my-secret`, `aaaa…`), mais ne peut pas
> prouver qu'un secret est aléatoire.

### Pourquoi ces règles ?

- **Liste d'algorithmes fixe** : empêche les attaques où un jeton annonce `alg: none`
  ou un autre algorithme pour contourner la signature.
- **`issuer` et `audience` obligatoires** : un jeton émis pour une autre application ou un
  autre client, même signé avec le même secret, est refusé.
- **Durée de vie courte** : un JWT ne peut pas être révoqué individuellement
  (voir [révocation](securite.md#révocation-des-jwt)) ; 15 minutes limitent l'impact d'une fuite.
- **Taille minimale de clé** : la RFC 7518 impose une clé au moins aussi longue que la sortie
  du hachage (256 bits pour HS256).

### Contenu des jetons émis

```json
// En-tête
{ "alg": "HS256", "typ": "at+jwt" }
// Charge utile
{ "sub": "<user.id>", "iss": "my-api", "aud": "my-client", "iat": 1760000000, "exp": 1760000900, "jti": "<uuid>" }
```

Aucune donnée personnelle n'est ajoutée : la charge utile d'un JWT est seulement encodée
en base64, **lisible par quiconque possède le jeton**.

À la vérification, sont contrôlés : la signature, l'algorithme, `typ`, `iss`, `aud`, `exp`,
`iat` (ni dans le futur, ni plus ancien que `expiresInSeconds`), la présence de `sub` et `jti`.

## Configuration Argon2id

| Option | Défaut | Minimum | Maximum | Unité |
| --- | --- | --- | --- | --- |
| `memoryCost` | `65536` (64 Mio) | `19456` (19 Mio) | `4194304` (4 Gio) | Kio |
| `timeCost` | `3` | `2` | `20` | itérations |
| `parallelism` | `4` | `1` | `16` | fils |

Les valeurs par défaut correspondent à la deuxième recommandation de la RFC 9106 ; le minimum
correspond à la recommandation OWASP (19 Mio, 2 itérations).

**Choisir ses paramètres** : visez 100 à 500 ms par hachage sur votre matériel de production
et vérifiez la mémoire disponible (chaque connexion simultanée consomme `memoryCost`).
Sur un petit conteneur (512 Mio), par exemple :

```javascript
const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  password: { memoryCost: 19456, timeCost: 2, parallelism: 1 }
});
```

Les paramètres sont enregistrés dans chaque hash : les modifier ne casse pas les hash existants,
qui restent vérifiables avec leurs paramètres d'origine.

## Variables d'environnement recommandées

```bash
# .env — ne jamais commiter ce fichier
AUTH_SECRET=<48 octets aléatoires en base64url>
```

```javascript
// Node.js 22+ charge le fichier sans dépendance : node --env-file=.env server.js
const auth = createAuthKit({
  users: userRepository,
  jwt: {
    secret: process.env.AUTH_SECRET,
    issuer: process.env.AUTH_ISSUER ?? "my-api",
    audience: process.env.AUTH_AUDIENCE ?? "my-client"
  }
});
```

## Exemples d'erreurs de configuration

| Configuration | Message |
| --- | --- |
| `secret` absent | `` `jwt.secret` is required. Generate one with: … `` |
| `secret: "changeme…"` | `` `jwt.secret` looks like a placeholder value. … `` |
| `secret` de 20 caractères | `` `jwt.secret` must be at least 32 bytes long for the selected algorithm. … `` |
| `algorithm: "none"` | `` `jwt.algorithm` must be one of: HS256, HS384, HS512. `` |
| `expiresInSeconds: 604800` | `` `jwt.expiresInSeconds` must be an integer between 30 and 86400. `` |
| `password: { memoryCost: 4096 }` | `` `password.memoryCost` must be an integer between 19456 and 4194304. `` |
| `jwt: { expiresIn: "1h", … }` | `` Unknown option(s) in `jwt`: expiresIn. Allowed: … `` |

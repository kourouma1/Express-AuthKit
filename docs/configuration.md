# Configuration

> **En bref** — Cette page explique comment configurer Express AuthKit avec `createAuthKit()`.
> Vous saurez générer un secret sûr, régler la durée de vie des tokens et choisir le coût
> du hachage des mots de passe.

## Vue d'ensemble

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

Vous passez un seul objet à `createAuthKit()`. Il contient quatre clés possibles :

- `users` : l'objet qui lit vos utilisateurs en base (voir [le repository utilisateur](repository-utilisateur.md)). Obligatoire.
- `jwt` : les réglages des tokens de connexion. Obligatoire.
- `password` : les réglages du hachage des mots de passe. Facultatif.
- `providers` : pour remplacer les briques par défaut ([providers personnalisés](providers-personnalises.md)). Rare.

La configuration est **vérifiée dès le démarrage**. Une option manquante, inconnue ou
dangereuse lève une `ConfigurationError` au lancement de l'application. Vous ne la découvrez
donc jamais pendant une requête.

Les clés inconnues sont refusées. Ainsi, une faute de frappe comme `expiresIn` au lieu de
`expiresInSeconds` ne passe pas inaperçue.

## Configuration JWT

Un **JWT** (ou *token*) est un petit texte signé que votre API remet à l'utilisateur après
sa connexion. L'utilisateur le renvoie ensuite à chaque requête pour prouver qui il est.

| Option | Défaut | Ce qu'il faut savoir |
| --- | --- | --- |
| `secret` | — | **Obligatoire.** Chaîne ou `Uint8Array`. Au moins 32 octets (HS256), 48 (HS384) ou 64 (HS512). |
| `issuer` | — | **Obligatoire.** Nom de votre API. 256 caractères maximum. |
| `audience` | — | **Obligatoire.** Nom du client autorisé. 256 caractères maximum. |
| `expiresInSeconds` | `900` (15 min) | Durée de vie du token. Entre 30 et 86 400 (24 h). |
| `algorithm` | `"HS256"` | `"HS256"`, `"HS384"` ou `"HS512"`. |
| `clockToleranceSeconds` | `0` | Décalage d'horloge accepté entre serveurs. Entre 0 et 60. |

Quelques mots sur ces options :

- Le **secret** est la clé qui signe les tokens. Quiconque le connaît peut fabriquer des tokens valides.
- L'**issuer** (« émetteur ») indique qui a créé le token. Il est écrit dans le champ `iss` du token.
- L'**audience** (« destinataire ») indique à qui le token est destiné. Il est écrit dans le champ `aud`.
- À la vérification, un token dont `iss` ou `aud` ne correspond pas est refusé.

### Générer le secret

1. Générez le secret avec la commande fournie :

   ```bash
   npx express-authkit secret
   # ou directement dans le fichier .env :
   echo "AUTH_SECRET=$(npx express-authkit secret)" >> .env
   ```

   Si le package n'est pas installé, cette commande fait la même chose :

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

2. Stockez-le dans une variable d'environnement (`AUTH_SECRET`) ou dans un gestionnaire de
   secrets (Vault, AWS Secrets Manager, GCP Secret Manager…).
3. Utilisez **le même** secret sur toutes les instances de votre API.

> **Attention**
>
> - Le secret doit venir d'un générateur aléatoire sûr. N'utilisez **jamais** un mot ou une phrase choisis à la main.
> - Ne commitez jamais le secret dans Git.
> - La bibliothèque refuse les secrets manifestement faibles : trop courts, valeurs d'exemple
>   (`changeme`, `my-secret`…) ou trop répétitifs (`aaaa…`). Ce contrôle est une simple
>   **heuristique** : il attrape les erreurs courantes, mais il ne peut pas prouver qu'un
>   secret est vraiment aléatoire.

### Pourquoi ces règles ?

- **Liste fixe d'algorithmes.** Un pirate ne peut pas envoyer un token marqué `alg: none`
  (« pas de signature ») ou un autre algorithme pour contourner la vérification.
- **`issuer` et `audience` obligatoires.** Un token créé pour une autre application est
  refusé, même s'il est signé avec le même secret.
- **Durée de vie courte.** Un JWT ne peut pas être annulé individuellement avant son
  expiration (voir [révocation](securite.md#révocation-des-jwt)). 15 minutes limitent les
  dégâts si un token est volé.
- **Taille minimale du secret.** La RFC 7518 (la norme des JWT) exige une clé au moins aussi
  longue que la signature produite : 256 bits pour HS256.

## Configuration Argon2id

**Argon2id** est l'algorithme qui transforme un mot de passe en **hash** : une empreinte
impossible à inverser. Il est volontairement lent et gourmand en mémoire, pour décourager
les pirates qui essaient des milliards de mots de passe.

| Option | Défaut | Minimum | Maximum | Unité |
| --- | --- | --- | --- | --- |
| `memoryCost` | `65536` (64 Mio) | `19456` (19 Mio) | `4194304` (4 Gio) | Kio |
| `timeCost` | `3` | `2` | `20` | itérations |
| `parallelism` | `4` | `1` | `16` | fils |

Les valeurs par défaut suivent la RFC 9106 (la norme d'Argon2). Les minimums suivent la
recommandation de l'OWASP (19 Mio, 2 itérations). Vous ne pouvez pas descendre en dessous.

Dans la plupart des cas, **gardez les valeurs par défaut**. Changez-les seulement si votre
serveur manque de mémoire. Par exemple, sur un petit conteneur de 512 Mio :

```javascript
const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  password: { memoryCost: 19456, timeCost: 2, parallelism: 1 }
});
```

Pour choisir vos valeurs :

1. Visez 100 à 500 ms par hachage sur votre serveur de production.
2. Vérifiez la mémoire disponible : **chaque connexion simultanée consomme `memoryCost`**.

Vous pouvez changer ces valeurs plus tard sans risque. Les paramètres sont enregistrés dans
chaque hash. Les anciens hash restent donc vérifiables avec leurs paramètres d'origine.

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

## Erreurs de configuration fréquentes

| Configuration | Message |
| --- | --- |
| `secret` absent | « L’option « jwt.secret » est obligatoire. Générez-en un avec : npx express-authkit secret … » |
| `secret: "changeme…"` | « L’option « jwt.secret » ressemble à une valeur d’exemple. … » |
| `secret` de 20 caractères | « L’option « jwt.secret » doit contenir au moins 32 octets pour l’algorithme choisi. … » |
| `algorithm: "none"` | « L’option « jwt.algorithm » doit valoir l’une de ces valeurs : HS256, HS384, HS512. » |
| `expiresInSeconds: 604800` | « L’option « jwt.expiresInSeconds » doit être un nombre entier compris entre 30 et 86400. » |
| `password: { memoryCost: 4096 }` | « L’option « password.memoryCost » doit être un nombre entier compris entre 19456 et 4194304. » |
| `jwt: { expiresIn: "1h", … }` | « Option inconnue dans « jwt » : expiresIn. Options acceptées : … » |

## Pour aller plus loin

### Contenu des tokens émis

```json
// En-tête
{ "alg": "HS256", "typ": "at+jwt" }
// Charge utile
{ "sub": "<user.id>", "iss": "my-api", "aud": "my-client", "iat": 1760000000, "exp": 1760000900, "jti": "<uuid>" }
```

Signification des champs :

- `sub` : l'identifiant de l'utilisateur.
- `iat` / `exp` : date de création et date d'expiration (en secondes).
- `jti` : identifiant unique du token.

Aucune donnée personnelle n'est ajoutée au token. C'est voulu : le contenu d'un JWT est
seulement encodé en base64, pas chiffré. **Quiconque possède le token peut le lire.**

À la vérification, la bibliothèque contrôle :

- la signature et l'algorithme ;
- le type `typ`, l'émetteur `iss` et le destinataire `aud` ;
- l'expiration `exp` ;
- la date `iat` : ni dans le futur, ni plus ancienne que `expiresInSeconds` ;
- la présence de `sub` et de `jti`.

### Fournir ses propres providers

Avec `providers.token`, vous ne passez pas d'options `jwt`. Avec `providers.password`, vous
ne passez pas d'options `password`. Les deux à la fois sont refusés. Voir
[providers personnalisés](providers-personnalises.md).

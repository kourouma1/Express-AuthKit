# Personnaliser les providers

**En bref** : un provider est la brique qui hache les mots de passe ou qui fabrique les tokens.
Cette page montre comment remplacer celle fournie par défaut par la vôtre. Vous saurez signer
vos tokens avec une clé Ed25519, migrer d'anciens mots de passe bcrypt et tester votre provider.

## Les deux notions à connaître

- **Provider** : un objet qui fait un travail précis pour la bibliothèque. Il en existe deux :
  - le provider de **mots de passe** hache et vérifie les mots de passe ;
  - le provider de **tokens** fabrique et vérifie les tokens d'accès.
- **Contrat** : la liste des méthodes qu'un provider doit avoir, avec ce qu'elles reçoivent
  et renvoient. Si votre objet respecte le contrat, la bibliothèque peut l'utiliser.

Par défaut, Express AuthKit utilise :

- `createArgon2PasswordProvider()` pour les mots de passe (algorithme Argon2id) ;
- `createJwtTokenProvider()` pour les tokens (JWT signés en HMAC avec la bibliothèque `jose`).

## Remplacer un provider

Passez votre objet dans l'option `providers` de `createAuthKit()` :

```javascript
const auth = createAuthKit({
  users: userRepository,
  providers: {
    password: myPasswordProvider, // remplace Argon2id : n'indiquez pas `password`
    token: myTokenProvider        // remplace le JWT HMAC : n'indiquez pas `jwt`
  }
});
```

Trois règles :

- Vous pouvez remplacer un seul provider ou les deux.
- Les contrats sont vérifiés au démarrage. S'il manque une méthode, vous obtenez une
  `ContractViolationError`.
- Ne combinez pas `jwt` avec `providers.token`, ni `password` avec `providers.password`.
  C'est refusé (`ConfigurationError`), car une des deux configurations serait ignorée sans
  avertissement.

## Contrat `PasswordProvider`

| Méthode | Signature | Ce qu'elle doit faire |
| --- | --- | --- |
| `hash` | `(password: string) => Promise<string>` | Utiliser un algorithme éprouvé et un sel aléatoire. Le hash produit doit contenir tout ce qu'il faut pour le vérifier plus tard (algorithme, paramètres, sel). |
| `verify` | `(password: string, hash: string) => Promise<boolean>` | Comparer en temps constant. Renvoyer **exactement** `true` si le mot de passe est bon : toute autre valeur compte comme un échec. Lever `InvalidPasswordHashError` si le hash est illisible. |

*Temps constant* : la comparaison prend le même temps, que le mot de passe soit presque bon
ou complètement faux. Un attaquant ne peut donc rien deviner en mesurant le temps de réponse.

## Contrat `TokenProvider`

| Méthode | Signature | Ce qu'elle doit faire |
| --- | --- | --- |
| `issue` | `({ subject }) => Promise<{ token, tokenId, issuedAt, expiresAt }>` | Créer un token pour l'utilisateur `subject`. Les dates sont en secondes Unix. Ne mettre aucune donnée sensible dans le token. |
| `verify` | `(token: string) => Promise<{ subject, tokenId, issuedAt, expiresAt }>` | Vérifier la signature, l'algorithme (liste fermée), l'expiration, l'émetteur, l'audience et le sujet. Lever `TokenExpiredError` si le token a expiré, `InvalidTokenError` pour tout autre refus. |

Même avec votre provider, le moteur garde ses propres contrôles :

- il vérifie que `subject` est une chaîne non vide ;
- il relit l'utilisateur avec `findById()`, donc un compte supprimé ou désactivé est refusé.

## Exemple : tokens signés en Ed25519 (clé asymétrique)

Le provider par défaut utilise **HMAC** : la même clé secrète sert à signer et à vérifier.
Tout service capable de vérifier un token peut donc aussi en fabriquer.

Avec une **clé asymétrique** comme Ed25519, il y a deux clés :

- la **clé privée** signe les tokens. Seul votre serveur d'authentification la possède ;
- la **clé publique** vérifie les tokens. Vous pouvez la donner aux autres services.

Ainsi, les autres services peuvent **vérifier** les tokens sans pouvoir en **émettre**.

**Étape 1** : générez une paire de clés.

```bash
# Générer une paire de clés Ed25519
openssl genpkey -algorithm ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
```

**Étape 2** : écrivez le provider.

```javascript
// eddsa-token-provider.js
import { SignJWT, errors, importPKCS8, importSPKI, jwtVerify } from "jose";
import { InvalidTokenError, TokenExpiredError } from "@express-authkit/core";

const ALGORITHM = "EdDSA";
const TOKEN_TYPE = "at+jwt";

/**
 * TokenProvider signant les jetons avec une clé privée Ed25519.
 * Les services qui vérifient les jetons n'ont besoin que de la clé publique.
 *
 * @returns {Promise<import("@express-authkit/core").TokenProvider>}
 */
export async function createEdDsaTokenProvider({ privateKeyPem, publicKeyPem, issuer, audience, expiresInSeconds = 900 }) {
  const privateKey = privateKeyPem ? await importPKCS8(privateKeyPem, ALGORITHM) : undefined;
  const publicKey = await importSPKI(publicKeyPem, ALGORITHM);

  return {
    async issue({ subject }) {
      if (!privateKey) throw new Error("This instance can only verify tokens.");
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + expiresInSeconds;
      const tokenId = crypto.randomUUID();
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: ALGORITHM, typ: TOKEN_TYPE })
        .setSubject(subject)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .setJti(tokenId)
        .sign(privateKey);
      return { token, tokenId, issuedAt, expiresAt };
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, publicKey, {
          algorithms: [ALGORITHM],
          issuer,
          audience,
          typ: TOKEN_TYPE,
          maxTokenAge: expiresInSeconds,
          requiredClaims: ["sub", "exp", "iat", "jti"]
        });
        return { subject: payload.sub, tokenId: payload.jti, issuedAt: payload.iat, expiresAt: payload.exp };
      } catch (error) {
        if (error instanceof errors.JWTExpired) throw new TokenExpiredError({ cause: error });
        if (error instanceof errors.JOSEError) throw new InvalidTokenError({ cause: error });
        throw error;
      }
    }
  };
}
```

**Étape 3** : branchez-le dans `createAuthKit()`.

```javascript
// server.js
import { readFile } from "node:fs/promises";
import { createAuthKit } from "@express-authkit/core";
import { createEdDsaTokenProvider } from "./eddsa-token-provider.js";

const auth = createAuthKit({
  users: userRepository,
  providers: {
    token: await createEdDsaTokenProvider({
      privateKeyPem: await readFile(process.env.AUTH_PRIVATE_KEY_PATH, "utf8"),
      publicKeyPem: await readFile(process.env.AUTH_PUBLIC_KEY_PATH, "utf8"),
      issuer: "my-api",
      audience: "my-client"
    })
  }
});
```

Un service qui ne fait que vérifier les tokens omet `privateKeyPem`. Il ne peut alors pas
en émettre.

## Exemple : migration depuis bcrypt

Vous avez une base avec d'anciens mots de passe hachés en **bcrypt** ? Ce provider les
accepte. Quand un utilisateur se connecte avec succès, la bibliothèque remplace son hash
bcrypt par un hash Argon2id
([modernisation automatique](mots-de-passe.md#moderniser-automatiquement-les-anciens-hash)).
Les comptes migrent donc au fil des connexions.

Il utilise `bcryptjs` (`npm install bcryptjs`).

```javascript
// migrating-password-provider.js
import bcrypt from "bcryptjs";
import { createArgon2PasswordProvider } from "@express-authkit/core";

/**
 * PasswordProvider qui accepte les anciens hash bcrypt. `needsRehash()` les signale :
 * après une connexion réussie, la bibliothèque les remplace par un hash Argon2id.
 *
 * @returns {import("@express-authkit/core").PasswordProvider}
 */
export function createMigratingPasswordProvider() {
  const argon2 = createArgon2PasswordProvider();
  const isBcrypt = (hash) => /^\$2[aby]\$/.test(hash);

  return {
    hash: (password) => argon2.hash(password),
    verify: (password, hash) => (isBcrypt(hash) ? bcrypt.compare(password, hash) : argon2.verify(password, hash)),
    needsRehash: (hash) => isBcrypt(hash) || argon2.needsRehash(hash)
  };
}
```

Branchez-le, et ajoutez `updatePasswordHash()` à votre repository pour enregistrer le
nouveau hash :

```javascript
// server.js (avec pg)
const users = {
  ...createPgUserRepository(pool),
  async updatePasswordHash(id, passwordHash) {
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, id]);
  }
};

const auth = createAuthKit({
  users,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  providers: { password: createMigratingPasswordProvider() }
});
```

Le nouveau hash n'est enregistré qu'après une connexion **complète** : bon mot de passe et
compte actif.

> **Attention** : bcrypt et Argon2id ne prennent pas le même temps de calcul. Pendant la
> migration, un attaquant qui mesure le temps de réponse peut deviner quel type de hash
> possède un compte. Gardez la période de migration courte. Ensuite, forcez la
> réinitialisation du mot de passe des comptes qui n'ont pas migré.

Ces exemples ont été exécutés (connexion, vérification, ré-hachage, refus d'un token
falsifié). Ils ne font pas partie de la suite de tests du dépôt.

## Tester un provider personnalisé

`assertPasswordProvider()` et `assertTokenProvider()` vérifient qu'un objet a bien les
méthodes du contrat :

```javascript
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { assertPasswordProvider, assertTokenProvider } from "@express-authkit/core";

import { createEdDsaTokenProvider } from "./eddsa-token-provider.js";
import { createMigratingPasswordProvider } from "./migrating-password-provider.js";

const publicKeyPem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });

test("les providers respectent les contrats", async () => {
  assertPasswordProvider(createMigratingPasswordProvider(async () => {}));
  assertTokenProvider(await createEdDsaTokenProvider({ publicKeyPem, issuer: "my-api", audience: "my-client" }));
});
```

Ces fonctions vérifient seulement la **présence** des méthodes, pas leur comportement.
Testez donc aussi, au minimum, qu'un token est refusé quand il est :

- expiré ;
- signé avec une autre clé ;
- émis par un mauvais émetteur ;
- destiné à une mauvaise audience.

Inspirez-vous de `tests/security/jwt-security.test.js`.

## Pour aller plus loin

### Utiliser les providers par défaut séparément

Les providers intégrés sont exportés. Vous pouvez les utiliser hors de `createAuthKit()`,
par exemple dans un script de migration :

```javascript
import { createArgon2PasswordProvider } from "@express-authkit/core";

const passwords = createArgon2PasswordProvider({ memoryCost: 65536, timeCost: 3, parallelism: 4 });
const hash = await passwords.hash("new password from a reset flow");
```

### Autres idées

D'autres évolutions (liste de révocation, clés multiples avec JWKS)
sont décrites dans les [points d'extension futurs](architecture.md#points-dextension-futurs).

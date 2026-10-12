# Personnaliser les providers

Express AuthKit fournit deux implémentations par défaut :

- `createArgon2PasswordProvider()` pour les mots de passe ;
- `createJwtTokenProvider()` pour les tokens (HMAC via `jose`).

Vous pouvez remplacer l'une ou l'autre en injectant un objet qui respecte le contrat
correspondant, avec l'option `providers` :

```javascript
const auth = createAuthKit({
  users: userRepository,
  providers: {
    password: myPasswordProvider, // remplace Argon2id : n'indiquez pas `password`
    token: myTokenProvider        // remplace le JWT HMAC : n'indiquez pas `jwt`
  }
});
```

Les contrats sont vérifiés au démarrage (`ContractViolationError` si une méthode manque).
Combiner `jwt` et `providers.token` (ou `password` et `providers.password`) est refusé,
car l'une des deux configurations serait ignorée silencieusement.

## Contrat `PasswordProvider`

| Méthode | Signature | Exigences |
| --- | --- | --- |
| `hash` | `(password: string) => Promise<string>` | Algorithme éprouvé, sel aléatoire, hash autonome (paramètres inclus). |
| `verify` | `(password: string, hash: string) => Promise<boolean>` | Comparaison en temps constant. Renvoyer **exactement** `true` en cas de succès (toute autre valeur est un échec). Lever `InvalidPasswordHashError` pour un hash illisible. |

## Contrat `TokenProvider`

| Méthode | Signature | Exigences |
| --- | --- | --- |
| `issue` | `({ subject }) => Promise<{ token, tokenId, issuedAt, expiresAt }>` | Dates en secondes Unix. Aucune donnée sensible dans le token. |
| `verify` | `(token: string) => Promise<{ subject, tokenId, issuedAt, expiresAt }>` | Vérifier signature, algorithme (liste fermée), expiration, émetteur, audience, sujet. Lever `TokenExpiredError` si expiré, `InvalidTokenError` pour tout autre rejet. |

Le moteur vérifie en plus que `subject` est une chaîne non vide, puis contrôle l'utilisateur
avec `findById()` : cette protection reste active avec un provider personnalisé.

## Exemple : tokens signés en Ed25519 (clé asymétrique)

Utile quand d'autres services doivent **vérifier** les tokens sans pouvoir en **émettre** :
seuls les serveurs d'authentification détiennent la clé privée.

```bash
# Générer une paire de clés Ed25519
openssl genpkey -algorithm ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
```

```javascript
// eddsa-token-provider.js
import { SignJWT, errors, importPKCS8, importSPKI, jwtVerify } from "jose";
import { InvalidTokenError, TokenExpiredError } from "express-authkit";

const ALGORITHM = "EdDSA";
const TOKEN_TYPE = "at+jwt";

/**
 * TokenProvider signant les jetons avec une clé privée Ed25519.
 * Les services qui vérifient les jetons n'ont besoin que de la clé publique.
 *
 * @returns {Promise<import("express-authkit").TokenProvider>}
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

```javascript
// server.js
import { readFile } from "node:fs/promises";
import { createAuthKit } from "express-authkit";
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

Un service qui ne fait que vérifier les tokens omet `privateKeyPem`.

## Exemple : migration depuis bcrypt

Ce provider accepte les anciens hash bcrypt et les remplace par un hash Argon2id dès que
l'utilisateur se connecte avec succès. Il utilise `bcryptjs` (`npm install bcryptjs`).

```javascript
// migrating-password-provider.js
import bcrypt from "bcryptjs";
import { createArgon2PasswordProvider } from "express-authkit";

/**
 * PasswordProvider qui accepte les anciens hash bcrypt et les remplace par
 * un hash Argon2id après une vérification réussie.
 *
 * @param {(oldHash: string, newHash: string) => Promise<void>} replaceHash
 *   Persiste le nouveau hash, par exemple :
 *   UPDATE users SET password_hash = $2 WHERE password_hash = $1
 * @returns {import("express-authkit").PasswordProvider}
 */
export function createMigratingPasswordProvider(replaceHash) {
  const argon2 = createArgon2PasswordProvider();

  return {
    hash: (password) => argon2.hash(password),

    async verify(password, hash) {
      if (!hash.startsWith("$2")) {
        return argon2.verify(password, hash);
      }
      const matches = await bcrypt.compare(password, hash);
      if (matches) {
        await replaceHash(hash, await argon2.hash(password));
      }
      return matches;
    }
  };
}
```

```javascript
// server.js (avec pg)
const auth = createAuthKit({
  users: createPgUserRepository(pool),
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  providers: {
    password: createMigratingPasswordProvider(async (oldHash, newHash) => {
      await pool.query("UPDATE users SET password_hash = $2 WHERE password_hash = $1", [oldHash, newHash]);
    })
  }
});
```

> Pendant la migration, bcrypt et Argon2id n'ont pas le même coût : la durée de réponse
> peut révéler quel type de hash possède un compte. Limitez la durée de la période de
> migration, puis forcez la réinitialisation des comptes restants.

Ces deux exemples ont été exécutés avec la version 0.1.0 (connexion, vérification,
ré-hachage, refus d'un token falsifié) ; ils ne font pas partie de la suite de tests du dépôt.

## Tester un provider personnalisé

```javascript
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { assertPasswordProvider, assertTokenProvider } from "express-authkit";

import { createEdDsaTokenProvider } from "./eddsa-token-provider.js";
import { createMigratingPasswordProvider } from "./migrating-password-provider.js";

const publicKeyPem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });

test("les providers respectent les contrats", async () => {
  assertPasswordProvider(createMigratingPasswordProvider(async () => {}));
  assertTokenProvider(await createEdDsaTokenProvider({ publicKeyPem, issuer: "my-api", audience: "my-client" }));
});
```

Testez aussi au minimum : token expiré, token signé avec une autre clé, mauvais émetteur et
mauvaise audience (inspirez-vous de `tests/security/jwt-security.test.js`).

## Utiliser les providers par défaut séparément

Les providers intégrés sont exportés et peuvent servir hors de `createAuthKit()`, par exemple
dans un script de migration :

```javascript
import { createArgon2PasswordProvider } from "express-authkit";

const passwords = createArgon2PasswordProvider({ memoryCost: 65536, timeCost: 3, parallelism: 4 });
const hash = await passwords.hash("new password from a reset flow");
```

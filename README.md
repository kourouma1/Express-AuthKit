<p align="center">
  <img src="docs/assets/banner.jpeg" alt="Express AuthKit — authentification pour Express.js : Argon2id, JWT, middleware de protection des routes" width="100%">
</p>

# Express AuthKit

> Moteur d'authentification sécurisé, léger et extensible pour Express.js.
> Argon2id pour les mots de passe, JWT signés avec `jose`, votre base de données.

**Statut : version candidate 0.1.0, non publiée sur npm.** Voir les [limites connues](docs/securite.md#limites-connues).

---

## Présentation

Express AuthKit regroupe ce qu'il faut pour authentifier les utilisateurs d'une API Express :

- hachage et vérification des mots de passe avec **Argon2id** ;
- émission et vérification strictes de **JWT d'accès** ;
- connexion par **identifiant et mot de passe** ;
- **middleware Express** qui protège vos routes ;
- **erreurs structurées** et réponses HTTP propres ;
- **configuration validée au démarrage** : un secret absent ou faible arrête l'application.

La bibliothèque **n'impose ni base de données, ni ORM, ni modèle utilisateur, ni routes** :
vous fournissez un petit objet `users` qui sait retrouver un utilisateur, le reste est géré.

## Pourquoi utiliser Express AuthKit ?

Sans bibliothèque dédiée, chaque projet réécrit les mêmes briques (JWT, hachage, middleware,
gestion d'erreurs) et refait souvent les mêmes erreurs de sécurité : algorithme JWT non fixé,
secret trop court, message d'erreur qui révèle l'existence d'un compte, compte désactivé
qui reste utilisable, hash de mot de passe renvoyé par l'API…

Express AuthKit applique ces règles par défaut, tout en restant remplaçable pièce par pièce
(repository, hachage, tokens) grâce à l'injection de dépendances.

## Prérequis

- **Node.js 22.12 ou plus récent** (Node.js 24 LTS recommandé).
- **Express 4.21+ ou 5.x** pour l'adaptateur Express.
- Un projet en **modules ES** (`"type": "module"` dans `package.json`).
- Un environnement capable d'installer `argon2` (binaires précompilés fournis pour Linux,
  macOS et Windows ; voir le [dépannage](docs/depannage.md) sinon).

## Installation

Une fois le package publié sur npm :

```bash
npm install express-authkit express
```

En attendant la publication, installez l'archive produite par `npm pack` :

```bash
# dans le dépôt express-authkit
npm pack
# dans votre projet
npm install /chemin/vers/express-authkit-0.1.0.tgz express
```

## Démarrage en cinq minutes

**1. Créez un projet**

```bash
mkdir mon-api && cd mon-api
npm init -y
npm pkg set type=module
npm install express-authkit express
```

**2. Générez un secret** (au moins 32 octets aléatoires) et placez-le dans un fichier `.env` :

```bash
echo "AUTH_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))")" > .env
```

**3. Créez `server.js`**

```javascript
import express from "express";
import { createAuthKit } from "express-authkit";
import { createExpressAuth } from "express-authkit/express";

// 1. Repository utilisateur : ici en mémoire, pour la démonstration.
//    En production, interrogez votre base de données (voir docs/repository-utilisateur.md).
const usersById = new Map();
const userRepository = {
  async findByIdentifier(identifier) {
    const email = identifier.trim().toLowerCase();
    for (const user of usersById.values()) {
      if (user.email === email) return user;
    }
    return null;
  },
  async findById(id) {
    return usersById.get(id) ?? null;
  }
};

// 2. Moteur d'authentification : la configuration est validée immédiatement.
const auth = createAuthKit({
  users: userRepository,
  jwt: {
    secret: process.env.AUTH_SECRET,
    issuer: "my-api",
    audience: "my-client",
    expiresInSeconds: 900
  }
});
const expressAuth = createExpressAuth(auth);

// 3. Utilisateur de démonstration (ne codez jamais de mot de passe réel en dur).
const hash = await auth.password.hash("example-password");
usersById.set("1", { id: "1", email: "alice@example.com", passwordHash: hash, isActive: true });

// 4. Application Express.
const app = express();
app.use(express.json());

app.post("/login", async (req, res, next) => {
  try {
    const { accessToken, tokenType, expiresIn } = await auth.login({
      identifier: req.body?.identifier,
      password: req.body?.password
    });
    res.json({ accessToken, tokenType, expiresIn });
  } catch (error) {
    next(error);
  }
});

app.get("/profile", expressAuth.authenticate(), (req, res) => {
  res.json({ userId: req.auth.userId });
});

// Transforme les erreurs d'authentification en réponses JSON 400 / 401.
app.use(expressAuth.errorHandler());

app.listen(3000, () => console.log("API sur http://localhost:3000"));
```

**4. Lancez et testez**

```bash
node --env-file=.env server.js
```

Dans un autre terminal :

```bash
# Connexion : renvoie { "accessToken": "...", "tokenType": "Bearer", "expiresIn": 900 }
curl -s -X POST http://localhost:3000/login \
  -H "content-type: application/json" \
  -d '{"identifier":"alice@example.com","password":"example-password"}'

# Route protégée sans token : 401 {"error":{"code":"TOKEN_MISSING",...}}
curl -i http://localhost:3000/profile

# Route protégée avec le token : {"userId":"1"}
curl -s http://localhost:3000/profile -H "authorization: Bearer <accessToken>"
```

> ⚠️ Avant la mise en production, ajoutez une **limitation des tentatives de connexion**
> ([exemple compatible multi-instances](docs/securite.md#limitation-des-tentatives-de-connexion))
> et servez l'API uniquement en **HTTPS**.

Une application complète (repository, rate limiting avec Redis optionnel, tests) se trouve dans
[examples/basic-express](examples/basic-express).

## Documentation

| Sujet | Fichier |
| --- | --- |
| Architecture et choix de conception | [docs/architecture.md](docs/architecture.md) |
| Configuration JWT et Argon2id | [docs/configuration.md](docs/configuration.md) |
| Hachage et vérification des mots de passe | [docs/mots-de-passe.md](docs/mots-de-passe.md) |
| Créer le repository utilisateur (Prisma, Mongoose, PostgreSQL…) | [docs/repository-utilisateur.md](docs/repository-utilisateur.md) |
| Connexion des utilisateurs et protection des routes | [docs/connexion-et-routes.md](docs/connexion-et-routes.md) |
| Gestion des erreurs | [docs/erreurs.md](docs/erreurs.md) |
| Bonnes pratiques et limites de sécurité | [docs/securite.md](docs/securite.md) |
| Référence de l'API publique | [docs/reference-api.md](docs/reference-api.md) |
| Personnaliser les providers | [docs/providers-personnalises.md](docs/providers-personnalises.md) |
| Dépannage et erreurs courantes | [docs/depannage.md](docs/depannage.md) |
| Contribuer | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Historique des versions | [CHANGELOG.md](CHANGELOG.md) |
| Signaler une vulnérabilité | [SECURITY.md](SECURITY.md) |

## Ce que la version 0.1.0 ne fait pas

Pas d'OAuth, de MFA, de RBAC, de refresh tokens, de sessions, de cookies ni de routes
automatiques. Ces sujets sont des [points d'extension prévus](docs/architecture.md#points-dextension-futurs),
pas des fonctionnalités disponibles.

## Licence

[MIT](LICENSE)

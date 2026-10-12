# Exemple : API Express avec Express AuthKit

Application complète montrant :

- un repository utilisateur (en mémoire) qui ne renvoie jamais le hash dans les profils ;
- une route de connexion avec **double limitation des tentatives** (par IP et par identifiant) ;
- un store Redis **facultatif** pour partager les compteurs entre plusieurs instances ;
- une route protégée `/me` ;
- une gestion d'erreurs qui ne divulgue aucun détail interne ;
- des tests automatisés (Node.js Test Runner, sans base de données).

## Lancer l'exemple

```bash
cd examples/basic-express
npm install
cp .env.example .env
```

Complétez `.env` :

```bash
# Génère le secret JWT
npx express-authkit secret
```

- `AUTH_SECRET` : la valeur générée ;
- `DEMO_USER_PASSWORD` : un mot de passe de votre choix pour l'utilisateur de démonstration.

Puis :

```bash
npm start
```

## Essayer

```bash
# Connexion
curl -s -X POST http://localhost:3000/auth/login \
  -H "content-type: application/json" \
  -d '{"identifier":"alice@example.test","password":"<DEMO_USER_PASSWORD>"}'

# Profil (remplacez <token>)
curl -s http://localhost:3000/me -H "authorization: Bearer <token>"
```

Après 5 échecs sur le même identifiant en 15 minutes, la connexion répond `429 TOO_MANY_REQUESTS`.

## Plusieurs instances

Définissez `REDIS_URL` (par exemple `redis://localhost:6379`) : les compteurs de tentatives
sont alors partagés. Derrière un load balancer, réglez `TRUST_PROXY_HOPS` sur le nombre de
proxys de confiance. Toutes les instances doivent partager le même `AUTH_SECRET`.

```bash
docker run --rm -p 6379:6379 redis:7
REDIS_URL=redis://localhost:6379 PORT=3001 npm start
REDIS_URL=redis://localhost:6379 PORT=3002 npm start
```

## Tests

```bash
npm test
```

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `src/server.js` | Lecture de l'environnement, assemblage, démarrage HTTP. |
| `src/app.js` | Application Express (dépendances injectées, donc testable). |
| `src/in-memory-user-repository.js` | Implémentation du contrat `UserRepository`. |
| `src/rate-limit.js` | Limiteurs de tentatives, store Redis facultatif. |
| `test/app.test.js` | Tests de bout en bout de l'application. |

> Le dépôt en mémoire perd ses données à chaque redémarrage. Pour une vraie base, voir
> [docs/repository-utilisateur.md](../../docs/repository-utilisateur.md).

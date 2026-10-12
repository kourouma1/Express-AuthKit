# Exemple : API Express avec Express AuthKit

Application complète montrant :

- un repository utilisateur (en mémoire) qui ne renvoie jamais le hash dans les profils ;
- une route de connexion protégée par la **limitation des tentatives intégrée** (par compte et par IP) ;
- un stockage Redis **facultatif** pour partager les compteurs entre plusieurs instances ;
- un **journal d'audit** (une ligne JSON par événement de sécurité dans la console) ;
- une route protégée `/me` ;
- une route réservée aux administrateurs `/admin/stats` (`expressAuth.authorize("admin")`) ;
- le rafraîchissement de session (`/auth/refresh`) et la déconnexion (`/auth/logout`, `/auth/logout-all`) ;
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

# Route réservée aux administrateurs (l'utilisateur de démonstration a le rôle « admin »)
curl -s http://localhost:3000/admin/stats -H "authorization: Bearer <token>"
```

Après 5 échecs sur le même identifiant en 15 minutes, la connexion répond `429` avec le code
`TOO_MANY_ATTEMPTS` et l'en-tête `Retry-After`. Chaque tentative apparaît dans la console :

```json
{"audit":"login.failed","type":"login.failed","at":"…","identifier":"alice@example.test","client":"::1","reason":"INVALID_PASSWORD","userId":"…"}
```

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
| `src/attempt-store.redis.js` | Stockage Redis des compteurs de tentatives (utilisé si `REDIS_URL` est défini). |
| `test/app.test.js` | Tests de bout en bout de l'application. |

> Le dépôt en mémoire perd ses données à chaque redémarrage. Pour une vraie base, voir
> [docs/repository-utilisateur.md](../../docs/repository-utilisateur.md).

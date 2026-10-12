# Rôles et permissions

**En bref** : `authenticate()` vérifie **qui** est l'utilisateur. `authorize()` vérifie **ce qu'il
a le droit de faire**. Une seule ligne suffit pour réserver une route aux administrateurs, à
une liste de rôles, à des permissions précises, ou à une règle à vous (« seul l'auteur peut
modifier son article »).

## Les mots à connaître

| Mot | En clair |
| --- | --- |
| **Rôle** | Un groupe d'utilisateurs : `"admin"`, `"editor"`, `"customer"`… |
| **Permission** | Un droit précis : `"orders:read"`, `"orders:write"`… Plus fin qu'un rôle. |
| **401** | « Je ne sais pas qui vous êtes » : pas de token, ou token invalide. |
| **403** | « Je sais qui vous êtes, mais vous n'avez pas le droit. » |

## Démarrage rapide

**Étape 1 — Renvoyez les rôles depuis votre repository**

Ajoutez `roles` (et, si besoin, `permissions`) à l'objet que renvoient `findByIdentifier()` et
`findById()` :

```javascript
const userRepository = {
  async findByIdentifier(email) {
    const user = await db.users.findByEmail(email);
    return user && { id: user.id, passwordHash: user.passwordHash, isActive: user.isActive, roles: user.roles };
  },
  async findById(id) {
    const user = await db.users.findById(id);
    return user && { id: user.id, passwordHash: user.passwordHash, isActive: user.isActive, roles: user.roles };
  }
};
```

> `db` représente votre couche d'accès aux données. `roles` et `permissions` sont des listes de
> textes. Ils sont **facultatifs** : un utilisateur sans rôle n'accède simplement à aucune route
> réservée.

**Étape 2 — Protégez vos routes**

```javascript
// Réservé au rôle « admin »
app.get("/admin", expressAuth.authorize("admin"), (req, res) => {
  res.json({ message: "Bienvenue, administrateur." });
});
```

C'est tout. `authorize()` vérifie aussi le token : inutile d'ajouter `authenticate()` avant.

| Situation | Réponse |
| --- | --- |
| Pas de token, ou token invalide | **401** |
| Token valide, mais pas le rôle « admin » | **403** `ACCESS_DENIED` |
| Token valide et rôle « admin » | la route s'exécute |

```json
{ "error": { "code": "ACCESS_DENIED", "message": "Accès refusé : vous n’avez pas les droits nécessaires." } }
```

## Les quatre façons d'écrire une règle

### 1. Un seul rôle

```javascript
app.delete("/users/:id", expressAuth.authorize("admin"), deleteUser);
```

### 2. Plusieurs rôles possibles : `anyRole`

L'utilisateur doit avoir **au moins un** de ces rôles.

```javascript
app.get("/dashboard", expressAuth.authorize({ anyRole: ["admin", "manager"] }), showDashboard);
```

### 3. Des permissions précises : `allPermissions`

L'utilisateur doit avoir **toutes** ces permissions.

```javascript
app.post("/orders/:id/refund", expressAuth.authorize({ allPermissions: ["orders:read", "orders:refund"] }), refund);
```

### 4. Une règle à vous : `check`

Pour les cas qui dépendent de la requête, par exemple « un utilisateur ne peut modifier que
son propre profil, sauf s'il est admin » :

```javascript
app.put(
  "/users/:id",
  expressAuth.authorize({
    check: (user, req) => user.userId === req.params.id || user.roles.includes("admin")
  }),
  updateUser
);
```

- `user` est l'utilisateur connecté (`userId`, `roles`, `permissions`).
- `req` est la requête Express.
- La fonction doit renvoyer `true` ou `false`. Elle peut être `async`, par exemple pour lire
  l'auteur d'un article en base.

```javascript
app.put(
  "/articles/:id",
  expressAuth.authorize({
    check: async (user, req) => {
      const article = await db.articles.findById(req.params.id);
      return article !== null && article.authorId === user.userId;
    }
  }),
  updateArticle
);
```

### Combiner les règles

Quand vous donnez plusieurs règles, **toutes** doivent être respectées :

```javascript
// Rôle « editor » ET permission « articles:publish »
expressAuth.authorize({ anyRole: ["editor"], allPermissions: ["articles:publish"] });
```

## Utiliser les rôles dans une route

Les rôles et permissions de l'utilisateur connecté sont dans `req.auth` :

```javascript
app.get("/me", expressAuth.authenticate(), (req, res) => {
  res.json({
    userId: req.auth.userId,
    isAdmin: req.auth.roles.includes("admin")
  });
});
```

## Bon à savoir

- **Les changements de rôle s'appliquent tout de suite.** Les rôles sont relus dans votre
  repository à chaque requête, pas stockés dans le token. Retirer le rôle « admin » à quelqu'un
  lui coupe l'accès dès sa requête suivante, sans attendre l'expiration du token.
- **Les rôles ne sont jamais écrits dans le JWT.** Le token reste petit et ne révèle rien.
- **Les noms sont sensibles à la casse** : `"Admin"` n'est pas `"admin"`.
- **Les règles sont vérifiées au démarrage.** Une faute (`{ role: "admin" }` au lieu de
  `{ anyRole: ["admin"] }`, liste vide…) arrête l'application avec un message clair.
- **Le message 403 ne dit pas quel droit manque**, pour ne rien révéler de votre organisation.

## Pour aller plus loin

### Hors d'Express : `isAuthorized()`

La même logique est disponible sans Express, par exemple dans un worker ou un autre framework :

```javascript
import { isAuthorized } from "@express-authkit/core";

const principal = await auth.verifyAccessToken(token);
if (!(await isAuthorized(principal, { anyRole: ["admin"] }))) {
  // refuser l'accès
}
```

Le troisième paramètre, facultatif, est transmis à `check` (avec Express, c'est la requête).

### Sécurité de `authorize()`

- `authorize()` ne fait confiance à `req.auth` **que s'il a été rempli par `authenticate()` ou
  `authorize()`** de la même instance. Un autre middleware qui écrirait `req.auth` ne peut pas
  usurper une identité ou s'attribuer un rôle.
- Si votre fonction `check` lève une erreur ou renvoie autre chose qu'un booléen (par exemple
  `"yes"` ou `undefined`), l'accès est **refusé** et l'erreur est transmise à votre gestionnaire
  d'erreurs (réponse 500). La bibliothèque ne devine jamais : en cas de doute, elle refuse.

### Limites

- Pas de hiérarchie de rôles automatique : si un « admin » doit aussi être « editor », donnez-lui
  les deux rôles, ou utilisez `anyRole: ["admin", "editor"]`.
- Pas de permissions sur chaque objet en base (ACL). Utilisez `check` pour ces cas.
- Au plus 256 rôles et 256 permissions par utilisateur, de 128 caractères chacun.

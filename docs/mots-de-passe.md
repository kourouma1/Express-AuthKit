# Hachage et vérification des mots de passe

> **En bref** — Cette page montre comment stocker un mot de passe de façon sûre et comment
> le vérifier plus tard. Vous saurez écrire une route d'inscription et une route de
> changement de mot de passe.

## Les notions en deux minutes

- **Hacher** un mot de passe, c'est le transformer en **hash** : une empreinte impossible à
  inverser. Vous stockez l'empreinte, jamais le mot de passe lui-même.
- Le **sel** est une valeur aléatoire ajoutée avant le hachage. Grâce à lui, deux
  utilisateurs avec le même mot de passe n'ont pas la même empreinte.
- **Argon2id** est l'algorithme utilisé. C'est celui que recommandent l'OWASP et la RFC 9106.

Vous n'avez rien à gérer vous-même. La bibliothèque génère le sel et le range dans le hash,
avec les paramètres utilisés.

## Hacher un mot de passe (inscription, changement de mot de passe)

```javascript
const passwordHash = await auth.password.hash(plainPassword);
// "$argon2id$v=19$m=65536,p=4,t=3$<sel>$<empreinte>"
```

- Stockez **uniquement** `passwordHash` en base de données. Jamais le mot de passe en clair.
- Deux appels avec le même mot de passe donnent deux hash différents. C'est normal : le sel change à chaque fois.

### Exemple complet : route d'inscription

```javascript
import { InvalidInputError } from "express-authkit";

const MIN_PASSWORD_LENGTH = 12; // OWASP : au moins 8, 12 à 15 recommandés

app.post("/register", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new InvalidInputError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    }

    const passwordHash = await auth.password.hash(password);
    const user = await db.users.create({ email: email.trim().toLowerCase(), passwordHash, isActive: true });

    // Ne renvoyez jamais passwordHash.
    res.status(201).json({ id: user.id, email: user.email });
  } catch (error) {
    next(error);
  }
});

app.use(expressAuth.errorHandler()); // InvalidInputError → 400
```

Ce que fait cette route :

1. Elle vérifie que l'e-mail et le mot de passe sont des textes, et que le mot de passe est assez long.
2. Elle hache le mot de passe avec `auth.password.hash()`.
3. Elle enregistre l'utilisateur avec son hash. `db.users.create` représente votre propre base de données.
4. Elle renvoie l'utilisateur **sans** son hash.
5. En cas d'erreur, `errorHandler()` répond 400 pour une `InvalidInputError`.

La **règle de longueur minimale** est à vous de la fixer. La bibliothèque refuse seulement
les mots de passe vides, non textuels ou de plus de 1 024 caractères.

> **Conseil** — Pour ne pas révéler qu'un e-mail est déjà inscrit, renvoyez la même réponse
> dans les deux cas. Prévenez ensuite l'utilisateur par e-mail.

## Vérifier un mot de passe (re-confirmation, changement de mot de passe)

```javascript
const matches = await auth.password.verify(plainPassword, storedHash); // true ou false
```

Pour la connexion, vous n'en avez **pas besoin** : `auth.login()` vérifie déjà le mot de
passe. Utilisez `verify()` quand un utilisateur déjà connecté doit confirmer son mot de
passe avant une action sensible.

Bon à savoir :

- `verify()` renvoie `true` ou `false`.
- Comme `hash()`, elle lève une `InvalidInputError` si le mot de passe est vide, n'est pas
  un texte ou dépasse 1 024 caractères.
- Si le hash stocké n'est pas au format Argon2id (bcrypt, texte brut…), elle lève une
  `InvalidPasswordHashError`. C'est un problème de données en base, pas un mauvais mot de passe.

### Exemple : changement de mot de passe

```javascript
app.post("/me/password", expressAuth.authenticate(), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    const user = await db.users.findById(req.auth.userId);

    if (!(await auth.password.verify(currentPassword, user.passwordHash))) {
      res.status(403).json({ error: { code: "INVALID_PASSWORD", message: "Le mot de passe actuel est incorrect." } });
      return;
    }

    await db.users.update(user.id, { passwordHash: await auth.password.hash(newPassword) });
    // Ferme toutes les sessions ouvertes ailleurs (nécessite l'option refreshTokens).
    await auth.revokeAllSessions(user.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
```

Étapes :

1. `authenticate()` vérifie que l'utilisateur est connecté et remplit `req.auth`.
2. La route relit l'utilisateur et vérifie son mot de passe actuel.
3. Si c'est le bon, elle enregistre le hash du nouveau mot de passe.
4. Elle ferme toutes les autres sessions avec `revokeAllSessions()` : un éventuel voleur est
   déconnecté. Sans l'option [`refreshTokens`](refresh-tokens.md), supprimez cette ligne.

> **Attention** — Les **tokens d'accès** déjà émis restent valides jusqu'à leur expiration
> (15 minutes par défaut). Voir [révocation](securite.md#révocation-des-jwt).

## Bonnes pratiques

- Ne journalisez jamais `req.body` sur les routes d'authentification : il contient le mot de passe.
- Ne renvoyez jamais `passwordHash` dans une réponse. Choisissez explicitement les champs publics.
- Limitez le nombre de tentatives de connexion ([rate limiting](securite.md#limitation-des-tentatives-de-connexion)).
  Argon2id est volontairement coûteux en CPU et en mémoire : sans limite, un attaquant peut surcharger votre serveur.

## Pour aller plus loin

### Comparaison en temps constant

La comparaison des empreintes est faite en **temps constant** par la bibliothèque `argon2`.
Autrement dit, elle prend le même temps que le mot de passe soit presque bon ou totalement
faux. Un attaquant ne peut donc rien deviner en mesurant le temps de réponse.

### Régler le coût d'Argon2id

Choisissez les coûts Argon2id selon votre matériel ([configuration](configuration.md#configuration-argon2id)).

### Migration depuis bcrypt

Les hash bcrypt (`$2b$…`) ne sont pas acceptés. Pour migrer sans forcer vos utilisateurs à
réinitialiser leur mot de passe :

1. Injectez un [`PasswordProvider` personnalisé](providers-personnalises.md#exemple--migration-depuis-bcrypt)
   qui sait vérifier les deux formats.
2. Après chaque connexion réussie, ré-hachez le mot de passe en Argon2id.

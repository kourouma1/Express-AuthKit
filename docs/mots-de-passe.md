# Hachage et vérification des mots de passe

Express AuthKit utilise **Argon2id**, l'algorithme recommandé par l'OWASP et la RFC 9106
pour stocker les mots de passe. Le sel est généré aléatoirement à chaque hachage et stocké
dans le hash, avec les paramètres.

## Hacher un mot de passe (inscription, changement de mot de passe)

```javascript
const passwordHash = await auth.password.hash(plainPassword);
// "$argon2id$v=19$m=65536,p=4,t=3$<sel>$<empreinte>"
```

Stockez **uniquement** `passwordHash` en base de données, jamais le mot de passe en clair.
Deux appels avec le même mot de passe produisent deux hash différents (sel aléatoire).

### Exemple complet : route d'inscription

La politique de mot de passe (longueur minimale, mots interdits…) relève de votre
application ; la bibliothèque refuse seulement les valeurs vides, non textuelles ou de plus
de 1 024 caractères.

```javascript
import { InvalidInputError } from "express-authkit";

const MIN_PASSWORD_LENGTH = 12; // OWASP : au moins 8, 12 à 15 recommandés

app.post("/register", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new InvalidInputError(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
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

> `db.users.create` représente votre couche de persistance. Pour ne pas révéler qu'un
> e-mail est déjà inscrit, renvoyez la même réponse dans les deux cas et prévenez
> l'utilisateur par e-mail.

## Vérifier un mot de passe (re-confirmation, changement de mot de passe)

`auth.login()` vérifie déjà le mot de passe ; vous n'avez besoin de `verify()` que pour des
actions sensibles où l'utilisateur, déjà connecté, confirme son mot de passe.

```javascript
const matches = await auth.password.verify(plainPassword, storedHash); // true ou false
```

- La comparaison est faite en **temps constant** par la bibliothèque `argon2`.
- Un hash qui n'est pas au format Argon2id (bcrypt, texte brut…) lève une
  `InvalidPasswordHashError` : c'est un problème de données, pas un mauvais mot de passe.

### Exemple : changement de mot de passe

```javascript
app.post("/me/password", expressAuth.authenticate(), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    const user = await db.users.findById(req.auth.userId);

    if (!(await auth.password.verify(currentPassword, user.passwordHash))) {
      res.status(403).json({ error: { code: "INVALID_PASSWORD", message: "Current password is incorrect." } });
      return;
    }

    await db.users.update(user.id, { passwordHash: await auth.password.hash(newPassword) });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
```

> Les tokens déjà émis restent valides jusqu'à leur expiration après un changement de mot de
> passe. Si vous devez les invalider immédiatement, voir [révocation](securite.md#révocation-des-jwt).

## Migration depuis bcrypt

Les hash bcrypt (`$2b$…`) ne sont pas acceptés. Pour migrer sans forcer de réinitialisation,
injectez un [`PasswordProvider` personnalisé](providers-personnalises.md#exemple--migration-depuis-bcrypt)
qui vérifie les deux formats, puis ré-hachez en Argon2id après une connexion réussie.

## Bonnes pratiques

- Ne journalisez jamais `req.body` sur les routes d'authentification.
- Ne renvoyez jamais `passwordHash` dans une réponse : sélectionnez explicitement les champs publics.
- Choisissez les coûts Argon2id selon votre matériel ([configuration](configuration.md#configuration-argon2id)).
- Limitez le nombre de tentatives ([rate limiting](securite.md#limitation-des-tentatives-de-connexion)) :
  Argon2id est volontairement coûteux en CPU et en mémoire.

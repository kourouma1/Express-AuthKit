# Le journal d'audit

**En bref** : un journal d'audit garde la trace des événements de sécurité (qui s'est connecté,
quelles connexions ont échoué, quel compte a été bloqué…). Il sert à repérer une attaque, à
comprendre un incident et à répondre aux obligations de traçabilité. Express AuthKit vous envoie
chaque événement : vous choisissez où l'enregistrer.

## Démarrage rapide

```javascript
const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  audit: (event) => console.log(JSON.stringify(event))
});
```

Chaque connexion produit alors une ligne de ce type :

```json
{"type":"login.failed","at":"2026-10-12T08:14:03.512Z","identifier":"alice@example.com","client":"203.0.113.7","reason":"INVALID_PASSWORD","userId":"42"}
```

En production, envoyez plutôt les événements à votre journal (pino, Winston…) ou dans une table :

```javascript
import pino from "pino";

const logger = pino();

const auth = createAuthKit({
  users: userRepository,
  jwt: { secret: process.env.AUTH_SECRET, issuer: "my-api", audience: "my-client" },
  audit: (event) => logger.info({ audit: event }, event.type)
});
```

## Les événements

| `type` | Quand ? | Informations utiles |
| --- | --- | --- |
| `login.succeeded` | Connexion réussie | `userId`, `identifier`, `client` |
| `login.failed` | Connexion refusée | `identifier`, `client`, `reason` (`USER_NOT_FOUND`, `INVALID_PASSWORD`, `ACCOUNT_DISABLED`, `INVALID_PASSWORD_HASH`), `userId` si le compte existe |
| `account.locked` | Un compte vient d'être bloqué après trop d'échecs | `identifier`, `client`, `retryAfterSeconds` |
| `login.blocked` | Une tentative a été refusée car le compte ou le client est bloqué | `identifier`, `client`, `scope` (`identifier` ou `client`), `retryAfterSeconds` |
| `token.rejected` | Un jeton d'accès a été refusé (falsifié, expiré, compte désactivé…) | `reason`, `client` |
| `access.denied` | Un utilisateur connecté n'avait pas le rôle ou la permission demandés | `userId`, `client`, `method`, `path` |
| `refresh.succeeded` | Une session a été renouvelée | `userId` |
| `refresh.rejected` | Un refresh token a été refusé | `reason`, `userId` si connu |
| `refresh.reuse_detected` | **Vol de session probable** : un refresh token déjà utilisé a été rejoué | `userId` |
| `logout` | Déconnexion | `userId` |
| `sessions.revoked` | Toutes les sessions d'un utilisateur ont été fermées | `userId` |
| `password.rehashed` | Un ancien hash a été modernisé à la connexion | `userId` |
| `password.rehash_failed` | La modernisation du hash a échoué (la connexion a quand même réussi) | `userId`, `error` (`{ code, dependency }` seulement ; le détail est dans l'avertissement `EXPRESS_AUTHKIT_REHASH`) |

Chaque événement contient aussi `at`, la date au format ISO 8601. Les types sont disponibles
dans la constante `AUDIT_EVENTS` :

```javascript
import { AUDIT_EVENTS } from "@express-authkit/core";

audit: (event) => {
  if (event.type === AUDIT_EVENTS.REFRESH_REUSE_DETECTED) {
    alertSecurityTeam(event.userId); // à vous de l'écrire
  }
}
```

## Ce qu'il faut savoir

- **Aucun mot de passe, hash ni jeton** n'est placé dans les événements par la bibliothèque.
  Attention toutefois : `identifier` est le texte saisi par l'utilisateur. Une personne qui tape
  son mot de passe dans le champ e-mail l'enverra donc dans `login.failed`. Protégez vos
  journaux en conséquence.
- **Des données personnelles** : `identifier` (souvent un e-mail) et `client` (adresse IP) en
  sont. Appliquez la même durée de conservation et les mêmes protections que pour vos autres
  journaux (RGPD).
- **L'authentification n'attend jamais le journal** : la promesse renvoyée par votre fonction
  n'est pas attendue. Un journal **asynchrone** lent ou en panne ne ralentit ni ne bloque une
  connexion. Une fonction **synchrone** lente, elle, ralentit chaque requête : écrivez de façon
  asynchrone (pino le fait par défaut).
- **Les erreurs de votre fonction ne sont pas perdues** : elles apparaissent sous forme
  d'avertissement Node.js (code `EXPRESS_AUTHKIT_AUDIT`), visible dans la console et
  interceptable avec `process.on("warning", …)`.
- **Les jetons absents ne sont pas journalisés** (`token.rejected` ne concerne que les jetons
  présents mais refusés) : un visiteur anonyme sur une route protégée n'est pas une anomalie.

## Pour aller plus loin

### Repérer une attaque

Quelques signaux utiles à surveiller dans vos journaux :

- beaucoup de `login.failed` avec `reason: "USER_NOT_FOUND"` depuis un même `client` : quelqu'un
  teste une liste d'e-mails ;
- des `account.locked` sur de nombreux comptes : attaque par force brute répartie ;
- tout `refresh.reuse_detected` : un refresh token a probablement été volé. La session a déjà été
  fermée automatiquement ; prévenez l'utilisateur.

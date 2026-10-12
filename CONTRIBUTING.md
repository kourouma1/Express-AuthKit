# Contribuer à Express AuthKit

Merci de votre intérêt ! Ce guide explique comment proposer une modification.

## Prérequis

- Node.js 22.12 ou plus récent (24 LTS recommandé, voir `.nvmrc`).
- npm 10 ou plus récent.

## Mise en place

```bash
git clone https://github.com/kourouma1/Express-AuthKit.git
cd Express-AuthKit
npm install
npm run check        # lint + tests
```

## Scripts disponibles

| Commande                | Rôle                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `npm test`              | Lance tous les tests (Node.js Test Runner).                          |
| `npm run test:coverage` | Lance les tests avec rapport de couverture.                          |
| `npm run lint`          | Analyse statique avec ESLint.                                        |
| `npm run check`         | Lint puis tests (exécuté aussi avant `npm publish`).                 |
| `npm run test:package`  | Empaquette la bibliothèque et la teste dans un projet vierge (réseau requis). |

## Règles du projet

- JavaScript ES2022+ uniquement, modules ES natifs, **pas de fichier TypeScript écrit à la main**.
  Les déclarations `types/*.d.ts` sont générées depuis le JSDoc (`npm run build:types`) et ne
  sont pas versionnées.
- Les contrats et API publiques sont documentés en JSDoc.
- `src/core/` ne doit importer ni Express, ni une base de données, ni un provider
  (un test d'architecture le vérifie).
- Aucune implémentation cryptographique maison.
- Toute fonctionnalité est accompagnée de tests ; toute modification touchant
  à la sécurité est accompagnée de tests de régression.
- La documentation (en français) est mise à jour avec le code.
- Pas de nouvelle dépendance de production sans justification dans la PR.

## Structure des tests

```
tests/
├── unit/          # services, configuration, contrats, providers, architecture
├── security/      # JWT falsifiés/expirés, énumération de comptes…
├── integration/   # application Express réelle, exports du package
└── helpers/       # fixtures et client HTTP de test
```

## Proposer une modification

1. Créez une branche à partir de `main`.
2. Faites des commits ciblés avec des messages explicites.
3. Ajoutez une entrée dans `CHANGELOG.md` sous « Non publié ».
4. Vérifiez que `npm run check` passe.
5. Ouvrez une pull request décrivant le problème, la solution et l'impact sécurité éventuel.

Les vulnérabilités ne doivent pas être signalées par issue publique : voir [SECURITY.md](SECURITY.md).

## Publier une nouvelle version (mainteneurs)

La publication est automatique : elle part d'une **Release GitHub**, et le workflow
`.github/workflows/release.yml` vérifie tout avant de publier sur npm. Aucun jeton npm n'est
stocké dans GitHub : npm reconnaît le workflow grâce à la *publication de confiance* (OIDC), et
chaque version reçoit une attestation de provenance (lien vérifiable vers le commit source).

### Configuration (une seule fois)

1. **Première publication à la main.** npm ne permet de configurer la publication de confiance
   que pour un package qui existe déjà. Publiez donc la première version depuis votre poste :
   `npm login`, puis `npm publish --tag next` pour une version candidate.
2. **Sur npmjs.com** : page du package → *Settings* → *Trusted publishing* → *GitHub Actions*.
   Renseignez : propriétaire `kourouma1`, dépôt `Express-AuthKit`, workflow `release.yml`,
   environnement `npm`.
3. **Sur GitHub** : *Settings* → *Environments* → créez l'environnement `npm`. Ajoutez-y des
   *Required reviewers* pour qu'une personne approuve chaque publication (recommandé).
4. **Sur npmjs.com, ensuite** : dans *Settings* → *Publishing access*, choisissez
   « Require two-factor authentication and disallow tokens ». Seul le workflow pourra alors
   publier.

### À chaque version

1. Mettez à jour `CHANGELOG.md` : déplacez « Non publié » vers la nouvelle version et sa date.
2. Changez la version, sans créer de tag local :

   ```bash
   npm version 0.2.0 --no-git-tag-version      # ou 0.2.0-rc.1 pour une version candidate
   ```

3. Commitez et poussez sur `main`, puis attendez que la CI soit verte.
4. Sur GitHub, créez une **Release** avec le tag `v0.2.0` (exactement « v » + la version de
   `package.json`). Copiez la section du CHANGELOG dans la description.
   Pour une version candidate, cochez *Set as a pre-release*.
5. Le workflow `Release` se lance. Il :
   - refuse de continuer si le tag ne correspond pas à `package.json` ;
   - lance lint, types et tests, puis teste le package dans un projet vierge ;
   - publie sur npm : sous l'étiquette `latest`, ou `next` pour une version candidate.
6. Vérifiez : `npm view @kourouma/express-authkit`.

> Une version publiée ne peut jamais être republiée. En cas d'erreur, publiez une version
> corrective (`0.2.1`) et dépréciez l'autre avec `npm deprecate @kourouma/express-authkit@0.2.0 "…"`.

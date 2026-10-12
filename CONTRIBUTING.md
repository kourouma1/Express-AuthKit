# Contribuer à Express AuthKit

Merci de votre intérêt ! Ce guide explique comment proposer une modification.

## Prérequis

- Node.js 22.12 ou plus récent (24 LTS recommandé, voir `.nvmrc`).
- npm 10 ou plus récent.

## Mise en place

```bash
git clone <url-du-depot>
cd express-authkit
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

- JavaScript ES2022+ uniquement, modules ES natifs, **pas de TypeScript**.
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

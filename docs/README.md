# Documentation d'Express AuthKit

**En bref** : commencez par le [README](../README.md). Tous les exemples sont en **JavaScript** ;
si vous utilisez **TypeScript**, commencez par [cette page](typescript.md). En cinq minutes, vous aurez une API avec
une route de connexion et une route protégée. Ensuite, choisissez la page qui répond à votre question.

## Je débute

| Je veux… | Page |
| --- | --- |
| Brancher ma base de données (PostgreSQL, Prisma, MongoDB…) | [Repository utilisateur](repository-utilisateur.md) |
| Connecter mes utilisateurs et protéger des routes | [Connexion et routes](connexion-et-routes.md) |
| Gérer l'inscription, le changement de mot de passe, refuser les mots de passe compromis | [Mots de passe](mots-de-passe.md) |
| Changer la durée des tokens ou le secret | [Configuration](configuration.md) |
| Garder l'utilisateur connecté et gérer la déconnexion | [Refresh tokens](refresh-tokens.md) |
| Réserver des routes à certains rôles ou permissions | [Rôles et permissions](roles-et-permissions.md) |
| Utiliser TypeScript (ou l'autocomplétion en JavaScript) | [TypeScript](typescript.md) |

## J'ai un problème

| Situation | Page |
| --- | --- |
| Un message d'erreur, quelque chose ne marche pas | [Dépannage](depannage.md) |
| Je veux comprendre ou personnaliser les erreurs renvoyées | [Erreurs](erreurs.md) |

## Je prépare la production

| Sujet | Page |
| --- | --- |
| Check-list de sécurité, limites connues | [Sécurité](securite.md) |
| Bloquer les attaques par force brute (active par défaut), plusieurs serveurs | [Limitation des tentatives](limitation-des-tentatives.md) |
| Garder une trace des connexions, échecs et accès refusés | [Journal d'audit](audit.md) |
| Toutes les fonctions disponibles | [Référence de l'API](reference-api.md) |

## Je veux aller plus loin

| Sujet | Page |
| --- | --- |
| Utiliser d'autres clés de signature ou migrer depuis bcrypt | [Providers personnalisés](providers-personnalises.md) |
| Comprendre comment le projet est construit | [Architecture](architecture.md) |
| Voir une application complète et testée | [Exemple Express](../examples/basic-express/README.md) |

## Le projet

[Contribuer](../CONTRIBUTING.md) · [Historique des versions](../CHANGELOG.md) · [Signaler une faille](../SECURITY.md)

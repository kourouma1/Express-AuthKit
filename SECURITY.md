# Politique de sécurité

## Versions prises en charge

| Version            | Correctifs de sécurité |
| ------------------ | ---------------------- |
| 1.x                | Oui                    |
| 0.x (préversions)  | Non : passez à 1.x     |

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique pour une vulnérabilité.**

Utilisez la fonction « Report a vulnerability » (GitHub Security Advisories)
du dépôt, en indiquant :

- la version concernée ;
- une description du problème et de son impact ;
- les étapes ou le code permettant de le reproduire.

Nous visons un accusé de réception sous 5 jours ouvrés et une première
évaluation sous 14 jours. La divulgation est coordonnée avec la personne
qui a fait le signalement.

## Périmètre et limites connues

Express AuthKit s'appuie sur `jose` (JWT) et `argon2` (Argon2id) et
n'implémente aucun algorithme cryptographique. Les limites de sécurité
connues (révocation des JWT, compteurs de tentatives en mémoire par défaut,
heuristique de détection des secrets faibles…) sont décrites dans
[docs/securite.md](docs/securite.md).

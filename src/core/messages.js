/**
 * Tous les messages d’erreur d’Express AuthKit, au même endroit.
 *
 * Les messages sont rédigés en français. Les applications ne doivent pas s’y
 * fier pour leur logique : elles utilisent le `code` stable de chaque erreur.
 * Centraliser les textes garantit un ton cohérent et facilitera une future
 * traduction.
 *
 * @module core/messages
 */

/** Commande proposée chaque fois qu’un secret JWT doit être (re)généré. */
const GENERATE_SECRET_HINT =
  "Générez-en un avec : npx express-authkit secret " +
  "(ou : node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\").";

/**
 * Messages publics : ils peuvent être renvoyés tels quels aux clients HTTP.
 * Ils ne révèlent jamais d’information interne.
 */
export const PUBLIC_MESSAGES = Object.freeze({
  invalidCredentials: "Identifiants invalides.",
  tokenMissing: "Authentification requise.",
  tokenInvalid: "Jeton d’accès invalide.",
  tokenExpired: "Jeton d’accès expiré.",
  refreshTokenInvalid: "Jeton de rafraîchissement invalide ou expiré. Reconnectez-vous.",
  accessDenied: "Accès refusé : vous n’avez pas les droits nécessaires.",
  credentialsNotObject: "Les identifiants doivent être un objet contenant « identifier » et « password ».",
  missingJsonBody:
    "Le corps de la requête doit être un objet JSON : envoyez l’en-tête « Content-Type: application/json ».",
  malformedJsonBody: "Le corps de la requête n’est pas un JSON valide.",
  payloadTooLarge: "Le corps de la requête est trop volumineux.",
  refreshTokenMalformed: "Le champ « refreshToken » est obligatoire et doit être un texte non vide.",
  userIdInvalid: "L’identifiant d’utilisateur doit être un texte non vide, un entier ou un ObjectId MongoDB."
});

/**
 * @param {string} field
 * @returns {string}
 */
export function fieldRequired(field) {
  return `Le champ « ${field} » est obligatoire et doit être un texte non vide.`;
}

/**
 * @param {string} field
 * @param {number} maxLength
 * @returns {string}
 */
export function fieldTooLong(field, maxLength) {
  return `Le champ « ${field} » ne doit pas dépasser ${maxLength} caractères.`;
}

/**
 * Messages destinés aux développeurs (configuration, contrats, pannes).
 * Ils expliquent toujours comment corriger le problème.
 */
export const DEVELOPER_MESSAGES = Object.freeze({
  // Mots de passe
  unsupportedPasswordHash:
    "Le hash de mot de passe enregistré n’est pas au format Argon2id. " +
    "Vérifiez qu’il a été produit par auth.password.hash(), ou migrez les anciens hash (voir docs/providers-personnalises.md).",

  // Options de createAuthKit()
  usersRequired:
    "L’option « users » est obligatoire : passez un objet qui possède les méthodes findByIdentifier() et findById().",
  jwtOrTokenProvider:
    "Utilisez soit l’option « jwt », soit « providers.token », mais pas les deux : l’une des deux serait ignorée.",
  jwtRequired: "L’option « jwt » est obligatoire (secret, issuer, audience).",
  passwordOrPasswordProvider:
    "Utilisez soit l’option « password », soit « providers.password », mais pas les deux : l’une des deux serait ignorée.",

  // Secret JWT
  secretRequired: `L’option « jwt.secret » est obligatoire. ${GENERATE_SECRET_HINT}`,
  secretWrongType: "L’option « jwt.secret » doit être un texte ou un Uint8Array.",
  secretPlaceholder: `L’option « jwt.secret » ressemble à une valeur d’exemple. ${GENERATE_SECRET_HINT}`,
  secretRepetitive: `L’option « jwt.secret » est trop répétitive pour être aléatoire. ${GENERATE_SECRET_HINT}`,

  // Adaptateur Express
  invalidRealm:
    "L’option « realm » doit contenir de 1 à 64 caractères : lettres, chiffres, espaces, points, tirets ou soulignés.",
  invalidIdentifierField:
    "L’option « identifierField » doit être un simple nom de champ, par exemple \"email\" ou \"username\".",

  // Contrats vérifiés pendant l’exécution
  repositoryRecordNotObject:
    "Le repository utilisateur doit renvoyer un objet, null ou undefined.",
  repositoryRecordId:
    "L’utilisateur renvoyé par le repository doit avoir un « id » : texte non vide, entier ou ObjectId MongoDB.",
  repositoryRecordPasswordHash:
    "L’utilisateur renvoyé par le repository doit avoir un « passwordHash » (texte non vide). " +
    "Si votre requête ne sélectionne que certains champs, ajoutez celui du hash.",
  repositoryRecordIsActive:
    "L’utilisateur renvoyé par le repository doit avoir un « isActive » booléen. " +
    "Si votre application ne permet pas de désactiver un compte, renvoyez « isActive: true ».",
  repositoryIdMismatch:
    "UserRepository.findById() a renvoyé un utilisateur dont l’« id » diffère de celui demandé.",
  tokenClaimsWithoutSubject:
    "TokenProvider.verify() doit renvoyer des informations contenant un « subject » non vide.",
  refreshStoreConsumeInvalid:
    "RefreshTokenStore.consume() doit renvoyer null, ou { userId, familyId, expiresAt, alreadyUsed } : " +
    "userId et familyId sont des textes, expiresAt un nombre de secondes, alreadyUsed un booléen.",
  refreshStoreRequired:
    "L’option « refreshTokens.store » est obligatoire : passez votre stockage (save, consume, revokeFamily, " +
    "revokeUser), ou createInMemoryRefreshTokenStore() pour le développement.",
  refreshTokensDisabled:
    "Les jetons de rafraîchissement ne sont pas activés. Ajoutez l’option « refreshTokens: { store } » " +
    "à createAuthKit() (voir docs/refresh-tokens.md).",
  authorizeRequirementInvalid:
    "expressAuth.authorize() attend un rôle (\"admin\") ou un objet { anyRole, allPermissions, check } " +
    "avec au moins une règle. anyRole et allPermissions sont des listes de textes non vides, check est une fonction.",
  authorizationCheckNotBoolean:
    "La fonction « check » de authorize() doit renvoyer true ou false (éventuellement via une promesse).",
  attemptStoreRequired:
    "L’option « loginAttempts.store » doit implémenter hit() et reset() " +
    "(ou retirez-la pour utiliser le stockage en mémoire).",
  attemptStoreResultInvalid:
    "AttemptStore.hit() doit renvoyer { count, resetAt } : count est un entier positif, resetAt la fin " +
    "de la fenêtre en secondes (pas en millisecondes) depuis l’époque Unix.",
  passwordHashUnreadable:
    "Un hash de mot de passe enregistré est illisible par le PasswordProvider (format inattendu ou base " +
    "corrompue). La connexion a été refusée comme un mauvais mot de passe. Pour migrer d’un autre algorithme, " +
    "voir docs/providers-personnalises.md.",
  passwordRehashFailed:
    "La modernisation d’un hash de mot de passe a échoué (UserRepository.updatePasswordHash() ou " +
    "PasswordProvider.hash()). La connexion a réussi ; le hash sera recalculé à la prochaine connexion.",
  pwnedResponseInvalid: "La réponse du service Pwned Passwords est illisible (portail captif, proxy ?).",
  secretWhitespace:
    "L’option « jwt.secret » commence ou se termine par un espace ou un retour à la ligne. " +
    "Retirez-le (fichier .env enregistré avec des fins de ligne Windows ?) : toutes les instances doivent avoir exactement le même secret.",
  auditHookInvalid: "L’option « audit » doit être une fonction qui reçoit chaque événement.",
  auditHookFailed:
    "Le gestionnaire d’audit (option « audit ») a levé une erreur. L’authentification n’est pas bloquée, " +
    "mais l’événement n’a peut-être pas été enregistré.",
  issuedTokenInvalid:
    "TokenProvider.issue() doit renvoyer { token, tokenId, issuedAt, expiresAt } : " +
    "token et tokenId sont des textes, issuedAt et expiresAt des nombres de secondes."
});

/**
 * @param {number} maxLength
 * @returns {string}
 */
export function subjectInvalid(maxLength) {
  return `Le « subject » du jeton doit être un texte non vide d’au plus ${maxLength} caractères.`;
}

/**
 * @param {string} name Nom de l’option, par exemple « jwt » ou « createAuthKit(options) ».
 * @returns {string}
 */
export function notPlainObject(name) {
  return `« ${name} » doit être un objet simple, par exemple { … }.`;
}

/**
 * @param {string} name
 * @param {string[]} unknownKeys
 * @param {readonly string[]} allowedKeys
 * @returns {string}
 */
export function unknownOptions(name, unknownKeys, allowedKeys) {
  const label = unknownKeys.length > 1 ? "Options inconnues" : "Option inconnue";
  return `${label} dans « ${name} » : ${unknownKeys.join(", ")}. Options acceptées : ${allowedKeys.join(", ")}.`;
}

/**
 * @param {string} name
 * @returns {string}
 */
export function optionRequiredString(name) {
  return `L’option « ${name} » doit être un texte non vide.`;
}

/**
 * @param {string} name
 * @param {number} maxLength
 * @returns {string}
 */
export function optionTooLong(name, maxLength) {
  return `L’option « ${name} » ne doit pas dépasser ${maxLength} caractères.`;
}

/**
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @returns {string}
 */
export function optionIntegerRange(name, min, max) {
  return `L’option « ${name} » doit être un nombre entier compris entre ${min} et ${max}.`;
}

/**
 * @param {readonly string[]} algorithms
 * @returns {string}
 */
export function unsupportedAlgorithm(algorithms) {
  return `L’option « jwt.algorithm » doit valoir l’une de ces valeurs : ${algorithms.join(", ")}.`;
}

/**
 * @param {number} minBytes
 * @returns {string}
 */
export function secretTooShort(minBytes) {
  return `L’option « jwt.secret » doit contenir au moins ${minBytes} octets pour l’algorithme choisi. ${GENERATE_SECRET_HINT}`;
}

/**
 * @param {string} contractName
 * @returns {string}
 */
export function contractNotObject(contractName) {
  return `${contractName} doit être un objet.`;
}

/**
 * @param {string} contractName
 * @param {string[]} missingMethods
 * @returns {string}
 */
export function contractMissingMethods(contractName, missingMethods) {
  const list = missingMethods.map((name) => `${name}()`).join(", ");
  return missingMethods.length > 1
    ? `${contractName} doit implémenter les méthodes suivantes : ${list}.`
    : `${contractName} doit implémenter la méthode ${list}.`;
}

/**
 * @param {string} dependency Par exemple « UserRepository.findById ».
 * @returns {string}
 */
export function dependencyFailed(dependency) {
  return `L’appel à ${dependency}() a échoué. Consultez la propriété « cause » de cette erreur pour connaître l’erreur d’origine.`;
}

/**
 * @param {string} method Par exemple « authenticate ».
 * @returns {string}
 */
export function middlewareFactoryMisuse(method) {
  return (
    `expressAuth.${method} doit être appelé avec des parenthèses : ` +
    `écrivez expressAuth.${method}() et non expressAuth.${method}.`
  );
}

/**
 * @param {string} field « roles » ou « permissions ».
 * @param {number} maxItems
 * @param {number} maxLength
 * @returns {string}
 */
export function repositoryRecordAuthorities(field, maxItems, maxLength) {
  return (
    `Le champ « ${field} » renvoyé par le repository doit être une liste de textes non vides ` +
    `(au plus ${maxItems} éléments de ${maxLength} caractères), ou être absent.`
  );
}

/**
 * @param {number} seconds
 * @returns {string}
 */
export function tooManyAttempts(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Trop de tentatives de connexion. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`;
}

/**
 * @param {number} status
 * @returns {string}
 */
export function pwnedHttpError(status) {
  return `Réponse HTTP ${status} du service Pwned Passwords.`;
}

import { ContractViolationError } from "../errors.js";

/**
 * Vérifie que `candidate` expose toutes les méthodes de `methodNames`.
 *
 * JavaScript n’a pas d’interfaces : les contrats sont vérifiés par leur forme
 * au démarrage afin de signaler clairement une dépendance mal configurée.
 *
 * @param {unknown} candidate Dépendance injectée.
 * @param {string} contractName Nom utilisé dans les messages d’erreur.
 * @param {readonly string[]} methodNames Méthodes exigées par le contrat.
 * @returns {void}
 * @throws {ContractViolationError}
 */
export function assertImplements(candidate, contractName, methodNames) {
  if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) {
    throw new ContractViolationError(`${contractName} must be an object.`);
  }

  const missing = methodNames.filter((name) => typeof candidate[name] !== "function");
  if (missing.length > 0) {
    throw new ContractViolationError(
      `${contractName} must implement: ${missing.map((name) => `${name}()`).join(", ")}.`
    );
  }
}

# CLAUDE.md — Express AuthKit

## 1. Project Identity

**Name:** Express AuthKit
**Type:** Open-source JavaScript authentication library
**Target:** Node.js and Express.js
**Current version:** 0.1.0 (in development)

Express AuthKit is a lightweight, secure, modular, and extensible authentication engine for Express.js applications.

Its purpose is to simplify authentication implementation without imposing a database, ORM, user model, or application architecture.

The library must remain easy to install, configure, understand, test, and extend.

**Developer experience is the core goal**: prefer one-line integrations, accept common input shapes, and make every error message say how to fix the problem — without weakening security defaults.

## 2. Mandatory Technology Rules

* Use JavaScript ES2022+ exclusively.
* Never write TypeScript source files by hand (no `.ts` sources).
* TypeScript declarations (`types/**/*.d.ts`) are generated from JSDoc by `npm run build:types` (run automatically on `prepack`). They are not committed. The only hand-maintained declaration is the `Express.Request.auth` augmentation, appended by `scripts/build-types.js`.
* JSDoc must stay precise: `npm run typecheck` (TypeScript strict mode, `checkJs`) must pass with zero errors.
* Use native ECMAScript modules (`<span>import</span>` / `<span>export</span>`).
* Use JSDoc for public APIs and contracts.
* Target a maintained Node.js LTS version.
* Use `<span>jose</span>` for JWT operations.
* Use Argon2id for password hashing.
* Use npm for package management.
* Use Node.js Test Runner for automated tests.
* Keep production dependencies minimal.
* Do not introduce unnecessary frameworks or abstractions.

All public examples must use plain JavaScript.

## 3. Architecture

Follow a lightweight hexagonal architecture.

The project is organized into:

* `<span>src/core/</span>`: framework-independent authentication logic.
* `<span>src/core/contracts/</span>`: behavioral contracts documented with JSDoc.
* `<span>src/providers/</span>`: JWT and password implementations.
* `<span>src/adapters/express/</span>`: Express middlewares and HTTP integration.
* `<span>src/config/</span>`: configuration validation.
* `<span>src/factory/</span>`: dependency injection and engine initialization.
* `src/core/messages.js`: every error message, in one place.
* `bin/`: the `@express-authkit/core` CLI (`npx express-authkit secret`).
* `scripts/`: type generation and packed-tarball verification.
* `types/`: generated TypeScript declarations (git-ignored).
* `<span>tests/</span>`: unit, integration, and security tests.
* `<span>examples/</span>`: working JavaScript examples.
* `<span>docs/</span>`: developer documentation.

### Dependency Rules

* Core must never import Express.
* Core must never depend on Prisma, Mongoose, Sequelize, or a specific database.
* Providers implement contracts expected by the Core.
* Adapters depend on public Core capabilities.
* Dependencies must point inward toward the Core.
* Avoid circular dependencies.
* Prefer dependency injection over global mutable state.
* Do not implement unnecessary abstractions.

## 4. Public API

Maintain a simple and stable developer experience.

Target API:

```
import { createAuthKit } from "@express-authkit/core";
import { createExpressAuth } from "@express-authkit/core/express";

const auth = createAuthKit({
  users: userRepository,
  jwt: {
    secret: process.env.AUTH_SECRET,
    issuer: "my-api",
    audience: "my-client",
    expiresInSeconds: 900
  }
});

const expressAuth = createExpressAuth(auth);
```

Expected capabilities:

* `<span>auth.login(credentials)</span>`
* `<span>auth.password.hash(password)</span>`
* `<span>auth.password.verify(password, hash)</span>`
* `<span>auth.verifyAccessToken(token)</span>`
* `<span>expressAuth.authenticate()</span>`
* `auth.refresh(refreshToken)`, `auth.logout(refreshToken)`, `auth.revokeAllSessions(userId)` (when `refreshTokens` is enabled)
* `expressAuth.authorize(requirement)` and `isAuthorized(principal, requirement, context?)`
* `expressAuth.login(options?)`, `expressAuth.refresh()`, `expressAuth.logout()`, `expressAuth.errorHandler()`
* `npx express-authkit secret`

Request handlers such as `expressAuth.login()` are not automatic routes: the application always chooses the URL.

Treat these names as the intended public API. Keep implementation, tests, and documentation consistent.

Do not introduce breaking public API changes without explaining them.

## 5. MVP Scope

Version 0.1.0 includes:

1. Argon2id password hashing.
2. Password verification.
3. JWT access token generation.
4. Strict JWT validation.
5. Identifier/password authentication.
6. Custom user repository integration.
7. Express authentication middleware.
8. Standardized authentication errors.
9. Secure configuration validation.
10. Automated tests and documentation.
11. Refresh tokens (opt-in through `refreshTokens: { store }`): rotation, reuse detection, logout, revoke all sessions.
12. Generated TypeScript declarations.
13. French error messages with stable English error codes.
14. Role- and permission-based authorization (`authorize()`, 403 `ACCESS_DENIED`).

Do not implement OAuth, MFA, role hierarchies or per-object ACLs, cookie-based sessions, password-reset or e-mail flows, or automatic authentication routes in the first release.

## 6. Security Rules

Security is a primary project requirement.

* Never implement custom cryptographic algorithms.
* Never hardcode secrets.
* Reject missing or insecure JWT secrets.
* Use explicit JWT algorithm allowlists.
* Validate JWT signature, issuer, audience, subject, and expiration.
* Use short-lived access tokens.
* Never include passwords or sensitive secrets in JWT payloads.
* Never expose password hashes through public responses.
* Reject disabled or deleted accounts.
* Use generic login errors to avoid user enumeration.
* Handle malformed tokens safely.
* Avoid logging credentials and tokens.
* Validate external input at trust boundaries.
* Document rate limiting and brute-force protection.
* Explicitly document the limitations of stateless JWT revocation.
* Refresh tokens are opaque random values (256 bits), never JWTs; store only their SHA-256 hash.
* Rotate refresh tokens on every use and revoke the whole family when a used token is replayed.
* `RefreshTokenStore.consume()` implementations must be atomic.
* Roles and permissions come from the repository on every request; never put them in JWTs.
* `authorize()` must only trust principals set by the same adapter instance, never a raw `req.auth`; authorization fails closed.
* Follow relevant OWASP security recommendations.

Any security-sensitive modification must include appropriate tests.

Do not claim a security guarantee that the implementation does not provide.

## 7. Coding Conventions

* Use descriptive English names for classes, functions, variables, and files.
* Prefer small modules with one clear responsibility.
* Use async/await for asynchronous operations.
* Use named exports for public modules when practical.
* Avoid magic numbers and duplicated logic.
* Do not silently swallow exceptions.
* Use structured error types and stable error codes.
* Write every error message in French, in `src/core/messages.js`; never hard-code message strings elsewhere. Error codes stay in English and are part of the public API.
* Wrap unexpected failures of injected dependencies (repository, providers, stores) in `DependencyFailureError` via `callDependency()`, keeping the original error in `cause`.
* Keep implementations independent of application-specific business logic.
* Do not add dependencies when native Node.js features are sufficient.
* Explain complex security decisions through concise comments.

Avoid overengineering. Readability and maintainability take priority over excessive design patterns.

## 8. Testing Requirements

For each new capability:

1. Implement the functionality.
2. Add unit tests.
3. Add integration tests when relevant.
4. Add security regression tests when relevant.
5. Update documentation.
6. Verify existing behavior remains compatible.

Essential test scenarios:

* Valid and invalid passwords.
* Unknown users.
* Disabled users.
* Valid JWTs.
* Expired JWTs.
* Tampered JWTs.
* Invalid issuer or audience.
* Missing Authorization headers.
* Invalid configuration.
* Repository failures.
* Express middleware behavior.
* Refresh token rotation, reuse, expiry, logout and concurrent refreshes.
* Generated types (strict check of a consumer file in `npm run test:package`).

Never claim tests passed unless they were executed successfully.

## 9. Documentation Rules

Documentation is a first-class project deliverable.

* Write user documentation primarily in French.
* Use simple and professional explanations: an « En bref » block at the top of each page, short sentences, every technical term explained at first use, code first then numbered steps, advanced material in « Pour aller plus loin » (never drop security warnings).
* Provide copy-paste-ready JavaScript examples.
* Explain prerequisites and environment variables.
* Include complete examples rather than isolated snippets.
* Explain why security configurations are necessary.
* Maintain API reference documentation.
* Update README when public behavior changes.
* Keep examples aligned with the actual published API.
* Do not document planned features as already available.

The README should help a new Express.js developer get started quickly. Its quick start is executed verbatim by `npm run test:package`: keep it runnable.

## 10. Scalability and Extensibility

The engine must support future growth without major rewrites.

* Keep authentication services stateless where appropriate.
* Avoid application-specific assumptions.
* Allow custom repositories.
* Allow interchangeable providers.
* Support multiple application instances.
* Do not require Redis, Kafka, or microservices for the MVP.
* Define extension points only when justified by actual use cases.
* Preserve backward compatibility whenever practical.
* Follow Semantic Versioning.

## 11. Development Workflow

Before modifying code:

1. Inspect the relevant existing modules.
2. Understand current public contracts.
3. Identify possible security implications.
4. Propose minimal architectural changes.
5. Avoid unrelated modifications.

During implementation:

1. Follow the established directory structure.
2. Maintain separation of responsibilities.
3. Write readable JavaScript.
4. Add tests alongside functionality.
5. Update documentation as needed.

After implementation:

1. Run `npm run check` (lint, strict typecheck, tests).
2. Run `npm run test:package` when the public API, packaging, README or examples change.
3. Check public API compatibility.
4. Check security-sensitive behavior.
5. Summarize changed files.
6. Report any limitations and unexecuted checks.

## 12. Package and Release Rules

* Use semantic versioning.
* Maintain a CHANGELOG.
* Define public entry points through `<span>package.json</span>` exports.
* Do not expose internal modules unintentionally.
* Exclude secrets, unnecessary files, and test fixtures from the published package.
* Test the packed NPM artifact in a clean JavaScript project.
* Never publish to NPM without explicit authorization.
* Never push changes or create releases without explicit authorization.

## 13. Communication Rules

When collaborating on this project:

* Respond in French unless another language is requested.
* Keep technical identifiers and source code in English.
* Explain important architectural decisions.
* Favor practical implementation over unnecessary theory.
* Clearly distinguish implemented features from proposals.
* Be transparent about security trade-offs.
* Ask for clarification only when a decision cannot reasonably be made from the existing project context.

## 14. Guiding Principle

**Express AuthKit must make authentication easier without making it less secure.**

Prioritize, in this order:

1. Security.
2. Correctness.
3. Simplicity of the developer experience.
4. Maintainability.
5. Extensibility.
6. Performance based on measurable needs.

Build a reliable authentication foundation before introducing advanced functionality.

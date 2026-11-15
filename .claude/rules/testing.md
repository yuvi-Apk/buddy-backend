---
paths:
  - "tests/**"
  - "vitest.config.ts"
---

# Testing

Tests run against real Postgres (`buddy_test`) and Redis (db 1) from `.env.test`, one file at a time.
`docker compose up -d` must be running.

## Layout

```
tests/
  helpers/     testApp.ts (app, container, resetState), fixtures.ts (createRole, createAdmin, ...),
               auth.ts (adminWith, superAdmin, loginAdmin, loginUser, bearer),
               guards.ts (expectLoginRequired, expectAdminPageRequired, MISSING_ID)
  guardrails/  ESLint rules, env files, every route has a guard
  platform/    app shell, data stores, HTTP building blocks, logging, cross-module guards
  modules/     <feature>.test.ts, one file per module
```

## Module test file

One `describe` per endpoint, named `"<METHOD> <path>"`. Inside, tests go in this order and each
test name starts with the status it checks:

```ts
describe("POST /admin/roles", () => {
  it("400 for bad input and unknown fields", ...);
  it("409 for a duplicate name", ...);          // rule failures
  it("201 creates the role and returns it", ...);
});
```

1. Guards (401/403). For admin routes, one `describe("guards on /admin/<features>")` at the top
   calls `expectAdminPageRequired(routes, "<PAGE>")` with every route of the module.
2. Validation (400): bad input, an unknown field, a malformed ID.
3. Not found or not the owner (404).
4. Rule failures (409, 403 for a forbidden action, 429).
5. Success, including "the response has no hash or internal field".

## Rules

- Start each file with `beforeEach(resetState)` and `afterAll(closeTestApp)`.
- Log in through the helpers in `auth.ts`, never by copying the login code.
- Never delete a test to make a change pass. Moving or renaming one is fine.
- A list endpoint test checks the pagination metadata and that `limit=101` returns 400.
- `pnpm test tests/modules/role.test.ts` runs one file.

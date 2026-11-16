---
name: write-tests
description: Write the missing tests for endpoints or a module that already exist in the Buddy backend, for example code a developer wrote by hand. Use when asked to "write tests", "add test cases" or "cover" a module or endpoint, or to check which endpoints have no tests.
---

# Write tests

Use this when the code already exists and the tests don't. It only adds tests. It never changes code
under `src/` to make a test pass. When a test shows a bug, stop and report it to the user.

The test rules are in `.claude/rules/testing.md`, and the full guide for people is `docs/07-testing.md`.
Use `tests/modules/role.test.ts` as the model to copy.

## 1. Find the target

- **The user named a module or an endpoint:** use that.
- **The user gave nothing:** run `git status` and `git diff --name-only main...HEAD`. Take every
  module under `src/modules/<feature>/` that changed, and tell the user which ones you picked.

## 2. List the endpoints

For each module:

1. Read `src/routes.ts` to find the mount path, for example
   `router.use("/admin/roles", ...)` → `/api/v1/admin/roles`.
2. Read `<feature>.routes.ts`. For each route, note:
   - method and full path
   - guard: `verifyAdmin` + `requirePermission("<PAGE>")`, `ownAccountRoute()`, `verifyUser`, or `publicRoute()`
   - the `validate({ body, query, params })` schemas
3. Read `<feature>.schema.ts`, so you know what valid input is and what is rejected.
4. Read `<feature>.service.ts`. Every `throw ApiError.*` is a test case: 404, 409, 403 and so on.
   Note every ownership check and every cache invalidation.
5. Read `<feature>.repository.ts`, so you know which fields the response may contain.

## 3. Compare with the existing tests

Open `tests/modules/<feature>.test.ts`, or create it if it doesn't exist. List the `describe("<METHOD> <path>")`
blocks already in it. Then show the user a short table:

| Endpoint | Has tests | Missing cases |
| -------- | --------- | ------------- |

Write only what is missing. Never delete or rewrite a passing test.

## 4. Write the tests

**A new file** starts like this:

```ts
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminWith, superAdmin } from "../helpers/auth.js";
import {
  expectAdminPageRequired,
  MISSING_ID,
  type Route,
} from "../helpers/guards.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const BASE = "/api/v1/admin/<features>";

beforeEach(resetState);
afterAll(closeTestApp);
```

**Guards.** Put one block at the top that lists every route of the module:

- Admin page routes: `describe("guards on /admin/<features>")` calling
  `expectAdminPageRequired(routes, "<PAGE>")`
- App routes: `expectLoginRequired(routes)`
- `publicRoute()` routes: no guard test, but a rate-limit (429) test if the route has `authRateLimit`

When you add an endpoint to an existing file, add its route to that `routes` list.

**One `describe("<METHOD> <path>")` per endpoint.** Inside, each test name starts with the status it
checks, in this order:

| Order | Status          | Cases to write                                                                                                               |
| ----- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | 400             | Each required field missing or invalid, an unknown field (`strictObject`), a malformed ID (`not-a-uuid`). Lists: `limit=101` |
| 2     | 404             | `MISSING_ID`. If rows have an owner: another caller's record also answers 404                                                |
| 3     | 409 / 403 / 429 | One test for each `throw ApiError.*` in the service that isn't a 400 or 404                                                  |
| 4     | 200 / 201       | The status, the data, the database row (through `prisma`), and no hash or internal field in the body                         |

For a list endpoint, also check `meta` (`page`, `limit`, `total`, `totalPages`) and the sort order.
For a change that clears a cache, check that the next request sees the change.

**Callers.** Always use the helpers. Never copy login code.

| Need                          | Use                                                          |
| ----------------------------- | ------------------------------------------------------------ |
| Admin with a page             | `adminWith(["<PAGE>"])`. Give a second admin its own email.  |
| Super admin                   | `superAdmin()`                                               |
| App user                      | `loginUser(phone)`. Give a second user a different phone.    |
| Row without logging in        | `createRole`, `createAdmin`, `createUser` from `fixtures.ts` |
| Data the helpers don't create | `prisma.<model>.create(...)` inside the test                 |

When the same setup appears in more than one file, add a helper to `tests/helpers/` instead.

**Loops for 400 cases.** Keep them short, and name the input so a failure shows which one broke:

```ts
for (const body of [{ name: "x" }, { name: "OK", extra: true }]) {
  expect(
    (await request(app).post(BASE).set(auth).send(body)).status,
    JSON.stringify(body)
  ).toBe(400);
}
```

## 5. Run and hand over

1. Run `pnpm test tests/modules/<feature>.test.ts`, then `pnpm lint`, `pnpm typecheck` and `pnpm test`.
2. If a test fails:
   - **The test is wrong:** fix the test.
   - **The code is wrong** (for example, there is no ownership check, a hash comes back, or a 500
     where a 400 should be): don't change `src/`. Leave the test failing, and report the bug to the
     user with the endpoint, what it should do and what it does. They decide whether to fix the code.
3. If a new table isn't in the `TRUNCATE` list in `tests/helpers/testApp.ts`, add it.
4. Stop, list the changed files, and give the commit message. Do not commit.

## Checklist

- [ ] Every route of the module is in the guards block
- [ ] Every endpoint has a `describe("<METHOD> <path>")`
- [ ] Each one covers 400 (bad input and unknown field), 404, the service's own errors, and success
- [ ] Rows with an owner: another caller gets 404
- [ ] Success tests check that no hash or internal field is in the body
- [ ] Lists: `meta` checked, `limit=101` gives 400
- [ ] Test titles say the expected result; fixture names say who they are (`.claude/rules/naming.md`)
- [ ] No test deleted, no file under `src/` changed

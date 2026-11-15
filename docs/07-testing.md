# 07 Testing

Tests run the real app against a real Postgres database (`buddy_test`) and Redis (database 1), with
the settings from `.env.test`. Nothing is mocked except the SMS sender and the password-hashing cost.

```bash
docker compose up -d                      # once
pnpm test                                 # everything
pnpm test tests/modules/role.test.ts      # one file
pnpm test -t "POST /admin/roles"          # tests whose name matches
```

Before the first file runs, `tests/setup/global-setup.ts` applies the migrations to `buddy_test`.
Files run one at a time because they share the database.

## Layout

```
tests/
  helpers/
    testApp.ts     the app and container, resetState(), closeTestApp(), prisma, redis, otpSender
    fixtures.ts    createRole, createAdmin, createSuperAdmin, createUser, TEST_PASSWORD
    auth.ts        adminWith(pages), superAdmin(), loginAdmin(email), loginUser(phone), bearer(token)
    guards.ts      expectLoginRequired(routes), expectAdminPageRequired(routes, page), MISSING_ID
  guardrails/      ESLint rules, env files, "every route has a guard"
  platform/        app shell, data stores, validate/pagination/rate limit, logging, cross-module guards
  modules/         <feature>.test.ts, one file per module
```

## A module test file

Every file starts the same way, so each test begins with empty tables and an empty Redis:

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

const ROLES = "/api/v1/admin/roles";

beforeEach(resetState);
afterAll(closeTestApp);
```

Then one `describe` per endpoint, named `"<METHOD> <path>"`. Inside, tests always come in the same
order, and each test name starts with the status it checks, so a failure tells you what broke:

1. **Guards (401/403).** For an admin module, one block at the top covers every route at once:

   ```ts
   describe("guards on /admin/roles", () => {
     const routes: Route[] = [
       ["get", ROLES],
       ["post", ROLES],
       ["patch", `${ROLES}/${MISSING_ID}`],
     ];
     it("401 without a login and 403 without the ROLE page, on every route", async () => {
       await expectAdminPageRequired(routes, "ROLE");
     });
   });
   ```

   `expectAdminPageRequired` checks no token (401), a user token (401) and an admin without the page
   (403). For app routes use `expectLoginRequired(routes)`.

2. **Validation (400):** bad input, an unknown field, a malformed ID, `limit=101` on a list.
3. **Not found or not the owner (404).**
4. **Rule failures:** 409 for a conflict, 403 for a forbidden action, 429 for a limit.
5. **Success:** the status, the data, and that no hash or internal field is in the body.

```ts
describe("POST /admin/roles", () => {
  it("400 for an unknown page, a bad name and unknown fields", async () => {
    const { auth } = await superAdmin();
    for (const body of [
      { name: "EDITOR", pages: ["BILLING"] },
      { name: "x" },
      { name: "EDITOR", isSuperAdmin: true },
    ]) {
      expect(
        (await request(app).post(ROLES).set(auth).send(body)).status,
        JSON.stringify(body)
      ).toBe(400);
    }
  });

  it("409 for a duplicate name, without database details", async () => {
    /* ... */
  });

  it("201 creates a role with pages and returns it", async () => {
    const { auth } = await superAdmin();
    const res = await request(app)
      .post(ROLES)
      .set(auth)
      .send({ name: "content_editor", pages: ["UPLOAD"] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "CONTENT_EDITOR",
      pages: ["UPLOAD"],
    });
  });
});
```

## Helpers

| Helper                                    | Gives you                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `adminWith(["ROLE"], email?)`             | An admin whose role has those pages, logged in: `{ admin, role, token, auth }` |
| `superAdmin()`                            | A logged-in SUPER_ADMIN: `{ admin, role, token, auth }`                        |
| `loginUser(phone?)`                       | A logged-in app user: `{ user, accessToken, refreshToken, auth }`              |
| `loginAdmin(email, password?)`            | The raw login response, to inspect cookies                                     |
| `bearer(token)`                           | `{ Authorization: "Bearer ..." }` for `.set(...)`                              |
| `createRole`, `createAdmin`, `createUser` | Rows straight in the database, without logging in                              |
| `otpSender.codes.get(phone)`              | The last code "sent" to a phone                                                |
| `MISSING_ID`                              | A valid UUID that matches nothing                                              |

Use the helpers instead of copying login code into a test file. If you need a new one that more
than one file will use, add it to `helpers/`.

## Guardrail tests

These protect the rules rather than a feature:

- `route-guards.test.ts` walks every route and fails if one has no guard, or an admin route has no
  permission check.
- `eslint-rules.test.ts` proves the lint rules still block what they should (Prisma in a controller,
  deep imports into another module, `process.env`).
- `env-sample.test.ts` fails if `.env.sample` or `.env.test` and the env schema list different variables.

If one of them fails, fix the code, not the test.

## Rules

- Never delete or skip a test to make a change pass. Moving or renaming one is fine.
- Each new table goes into the `TRUNCATE` list in `helpers/testApp.ts`.
- Every new endpoint gets tests for: 401, 403 (admin), 400, 404, not the owner, and success.

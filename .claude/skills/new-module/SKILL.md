---
name: new-module
description: Create a new feature module in the Buddy backend (the five files, wiring, permission page, migration and tests). Use when asked to add a new feature, resource or module such as "school", "student" or "book".
---

# New module

Every feature lives in `src/modules/<feature>/` and has exactly five files. Copy the shape of
`src/modules/role/` (admin CRUD with a page permission). For a module the mobile app calls,
look at `src/modules/user-auth/` for the `verifyUser` guard.

Use kebab-case for the folder and file names (`learning-path`), PascalCase for classes
(`LearningPathService`), and the singular form (`role`, not `roles`).

## Before writing code

1. Read `docs/RULES.md` and the five files in `src/modules/role/`.
2. Decide: who calls it (admin panel, app, or both), which table(s) it owns, and whether the
   rows belong to someone (a school, a user). If they do, plan the ownership check now.

## Steps, in this order

1. **Database** (skip if no new table). Edit `prisma/schema.prisma`, then run
   `pnpm exec prisma migrate dev --name add_<feature>`. Add the new table to the `TRUNCATE`
   list in `tests/helpers/testApp.ts`.
   - School-owned tables get a required `schoolId` column and an index on it.
2. **`<feature>.schema.ts`**: Zod schemas with `z.strictObject` for body, query and params, the
   types inferred from them, and a `<Feature>Dto` interface for what the API returns.
   List queries extend `paginationQuery` from `src/utils/pagination.ts`.
3. **`<feature>.repository.ts`**: a class that takes `PrismaClient` in the constructor.
   Every query uses an explicit `select`. Never return a hash or secret. Counters and balances
   use one conditional `updateMany` (see "Atomic update pattern" in `CLAUDE.md`).
4. **`<feature>.service.ts`**: a class with the rules. Throw `ApiError` for expected failures.
   Check ownership here on every read or change by ID, and answer 404 (not 403) for someone
   else's record. To use another module, inject its **service**, never its repository.
5. **`<feature>.controller.ts`**: a class whose methods are arrow properties. Read input only
   from `req.validated`, call the service, send `new ApiResponse(status, data, message)`.
6. **`<feature>.routes.ts`**: `create<Feature>Router(controller, deps)`. Every route has, in
   this order: guard(s), `validate({...})`, `asyncHandler(controller.method)`.
   - Admin route: `verifyAdmin`, then `requirePermission("<PAGE>")`.
   - Admin route that only touches the caller's own account: `verifyAdmin`, `ownAccountRoute()`.
   - App route: `verifyUser`.
   - Open on purpose: `publicRoute()` (and `authRateLimit` if it can be abused).
   - Put fixed paths (`/pages`) above parameter paths (`/:id`).
7. **Permission page** (admin modules). Add the page name to `PAGES` in
   `src/config/rbac.config.ts`. Update the two tests that list all pages
   (`tests/rbac.test.ts`: search for `["ROLE", "UPLOAD"]`).
8. **Wire it** in `src/container.ts`: repository → service → controller, add the controller to
   the `Container` interface and the returned object. Then mount the router in `src/routes.ts`
   under `/admin/<features>` or `/user/<features>`.
9. **Tests** in `tests/<feature>.test.ts` using `tests/helpers/testApp.ts` and
   `tests/helpers/fixtures.ts`. Cover at least:
   - 401 without a token, 403 without the page permission, success with it
   - validation: bad input and an unknown field both return 400
   - 404 for a missing record and for a malformed ID (400)
   - ownership: one caller cannot read or change another caller's record
   - the response never contains hashes or other internal fields
   - list: pagination metadata and `limit` above 100 rejected

## Finish

Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. All three must pass.
`tests/guardrails/route-guards.test.ts` fails if any new route has no guard, and
`tests/guardrails/eslint-rules.test.ts` covers the import rules.

If you added an env variable, follow "Env files" in `CLAUDE.md`. If you added a package, say
why in the commit message. Then commit.

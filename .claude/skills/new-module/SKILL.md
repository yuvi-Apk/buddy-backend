---
name: new-module
description: Create a new feature module in the Buddy backend (the six files, wiring, permission page, migration and tests). Use when asked to add a new feature, resource or module such as "school", "student" or "book".
---

# New module

Every feature lives in `src/modules/<panel>/<feature>/`, where `<panel>` is who calls it:

| Panel folder   | Used by                | Files                                                                                                                                                                  | Copy                                |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `admin-panel/` | super admin panel only | six: schema, repository, service, controller, routes, `index.ts`                                                                                                       | `src/modules/admin-panel/role/`     |
| `user-panel/`  | user panel (app) only  | six, as above                                                                                                                                                          | `src/modules/user-panel/classroom/` |
| `shared/`      | both panels            | schema, repository, service, `index.ts`, plus `<feature>.admin.controller.ts`, `<feature>.admin.routes.ts`, `<feature>.user.controller.ts`, `<feature>.user.routes.ts` | `src/modules/shared/invite/`        |

`index.ts` builds the module and is the only file other code may import.

Use kebab-case for the folder and file names (`learning-path`), PascalCase for classes
(`LearningPathService`), and the singular form (`role`, not `roles`).

## Before writing code

1. Read `.claude/rules/modules.md`, `.claude/rules/naming.md` and the six files in `src/modules/admin-panel/role/`. The full guide for
   people is `docs/03-create-a-module.md`.
2. Decide: who calls it (admin panel, app, or both), which table(s) it owns, and whether the
   rows belong to someone (a school, a user). If they do, plan the ownership check now.
3. Pick the panel folder from who calls it (table above) and tell the user which one. If only one
   panel needs it today, use that panel; it moves to `shared/` the day the other panel needs it.

## Steps, in this order

1. **Database** (skip if no new table). Edit `prisma/schema.prisma`, then run
   `pnpm exec prisma migrate dev --name add_<feature>`. Add the new table to the `TRUNCATE`
   list in `tests/helpers/testApp.ts`.
   - Organization-owned tables get a required `organizationId` column and an index on it.
   - Name the model and fields, and add the table `@@map`, as in `.claude/rules/naming.md`.
2. **`<feature>.schema.ts`**: Zod schemas with `z.strictObject` for body, query and params, the
   types inferred from them, and a `<Feature>Dto` interface for what the API returns.
   List queries extend `paginationQuery` from `src/utils/pagination.ts`.
3. **`<feature>.repository.ts`**: a class that takes `PrismaClient` in the constructor.
   Every query uses an explicit `select`. Never return a hash or secret. Counters and balances
   use one conditional `updateMany` (see `.claude/rules/database.md`).
4. **`<feature>.service.ts`**: a class with the rules. Throw `ApiError` for expected failures.
   Check ownership here on every read or change by ID, and answer 404 (not 403) for someone
   else's record. To use another module, inject its **service**, never its repository.
5. **`<feature>.controller.ts`**: a class whose methods are arrow properties. Read input only
   from `req.validated`, call the service, send `new ApiResponse(status, data, message)`.
   In `shared/`: `<feature>.admin.controller.ts` (`<Feature>AdminController`) and
   `<feature>.user.controller.ts` (`<Feature>UserController`), both using the one service.
6. **`<feature>.routes.ts`**: `create<Feature>Router(controller, deps)`. In `shared/`:
   `<feature>.admin.routes.ts` (`create<Feature>AdminRouter`, admin guards only) and
   `<feature>.user.routes.ts` (`create<Feature>UserRouter`, user guards only). Every route has, in
   this order: guard(s), `validate({...})`, `asyncHandler(controller.method)`.
   - Admin route: `verifyAdmin`, then `requirePermission("<PAGE>")`.
   - Admin route that only touches the caller's own account: `verifyAdmin`, `ownAccountRoute()`.
   - App route: `verifyUser`. Inside one organization: `verifyUser`, `requireOrganizationRole(...)`,
     then scope every query by `req.membership.organizationId`.
   - Open on purpose: `publicRoute()` (and `authRateLimit` if it can be abused).
   - Put fixed paths (`/pages`) above parameter paths (`/:id`).
7. **Permission page** (admin modules). Add the page name to `PAGES` in
   `src/config/rbac.config.ts`. Update the two tests that list all pages
   (`tests/modules/admin-panel/role.test.ts` and `tests/modules/admin-panel/admin-auth.test.ts`: search for `"ROLE", "UPLOAD"`).
8. **`index.ts`**: `create<Feature>Module(infra, deps)` builds repository → service →
   controller and returns `{ service?, router: (deps: RouterDeps) => create<Feature>Router(...) }`.
   In `shared/` it builds both controllers and returns `adminRouter` and `userRouter`
   (copy `src/modules/shared/invite/index.ts`).
   Export only the types other code needs (`export type { <Feature>Service, <Feature>Dto }`).
   Copy `src/modules/admin-panel/role/index.ts`. To use another module, import from its `index.js` only:
   `../role/index.js` in the same panel, `../../shared/session/index.js` from another panel.
9. **Wire it**: one line in `src/container.ts`
   (`import { create<Feature>Module } from "./modules/<panel>/<feature>/index.js"`,
   `const <feature> = create<Feature>Module(infra, {...})`, then add it to `modules`), and one line
   per mount in `src/routes.ts` under the matching `// --- admin panel ---` or `// --- mobile app ---`
   block (`router.use("/admin/<features>", modules.<feature>.router(deps))`; a shared module mounts
   `adminRouter` under `/admin/...` and `userRouter` under `/user/...`).
10. **Tests** in `tests/modules/<panel>/<feature>.test.ts` (same panel folder as the module;
    helpers are imported from `../../helpers/`), one `describe("<METHOD> <path>")` per endpoint, using
    `tests/helpers/auth.ts`, `tests/helpers/guards.ts`, `tests/helpers/testApp.ts` and
    `tests/helpers/fixtures.ts`. Cover at least:
    - 401 without a token, 403 without the page permission, success with it
    - validation: bad input and an unknown field both return 400
    - 404 for a missing record and for a malformed ID (400)
    - ownership: one caller cannot read or change another caller's record
    - the response never contains hashes or other internal fields
    - list: pagination metadata and `limit` above 100 rejected

## Finish

Check every new name against `.claude/rules/naming.md` (a reader knows what it holds or does
without opening another file). Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. All three must pass.
`tests/guardrails/route-guards.test.ts` fails if any new route has no guard, and
`tests/guardrails/eslint-rules.test.ts` covers the import rules.

If you added an env variable, follow `.claude/rules/env.md`. If you added a package, say
why in the commit message. Then stop and give the user the commit message. Do not commit.

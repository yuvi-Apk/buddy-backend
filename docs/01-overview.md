# 01 Overview

This guide shows how the code is laid out and what happens to a request from the moment it
arrives until the response leaves. Read it first; every other guide builds on it.

## The big idea

Every feature is a **module**: one folder in `src/modules/` with the same six files. A request
always moves through the same layers, and each layer has one job:

| Layer      | Job                                                       | Never does                     |
| ---------- | --------------------------------------------------------- | ------------------------------ |
| Route      | Path, who may call it (guard), input check (`validate`)   | Business rules                 |
| Controller | Takes the checked input, calls the service, sends a reply | Database queries, rules        |
| Service    | The rules: ownership, "is this allowed?", transactions    | Read `req`/`res`, send a reply |
| Repository | Database queries                                          | Rules, HTTP                    |

Because every module looks the same, once you know `src/modules/admin-panel/role/` you know them all.

## Folder map

```
src/
  server.ts          starts the HTTP server, shuts down cleanly on Ctrl+C / deploy
  app.ts             builds the Express app: security headers, CORS, body limit, logging
  container.ts       creates shared pieces (database, Redis, token service...) and each module
  routes.ts          mounts each module under /api/v1, one line per module
  config/            env.ts (validated settings), prisma.ts, redis.ts, logger.ts,
                     rbac.config.ts (admin pages), upload.config.ts
  types/             express.d.ts (fields added to req), module.types.ts (wiring types)
  utils/             ApiError, ApiResponse, asyncHandler, errorHandler, pagination, upload helpers
  middlewares/       guards (verifyAdmin, verifyUser, requirePermission, requireOrganizationRole), validate, rate limit, upload
  core/              shared infrastructure with no business rules: Google sign-in, tokens,
                     permission cache, file storage, health check. AI clients will live in core/ai.
  modules/           one folder per feature, grouped by panel:
    admin-panel/     super admin panel only (admin-account, admin-auth, role, upload)
    user-panel/      user panel only (user-auth, classroom, join-request)
    shared/          both panels (session, organization, invite)
  generated/prisma/  generated database client (never edit, git-ignored)
prisma/              schema.prisma, migrations/, seed.ts
tests/               helpers/, guardrails/, platform/, modules/<panel>/ (same panels as src/modules)
docs/                these guides
.claude/             rules, skills and hooks for Claude Code
```

## A request, step by step

Take `PATCH /api/v1/admin/roles/:id` (change a role) as the example.

1. **`src/app.ts`** logs the request with a request ID, adds security headers (helmet), checks the
   CORS origin, reads the JSON body (max 100 kb) and cookies.
2. **`src/routes.ts`** applies the global rate limit and hands `/admin/roles/...` to the role module:

   ```ts
   router.use("/admin/roles", modules.role.router(deps));
   ```

3. **`role.routes.ts`** runs, in order:

   ```ts
   router.patch(
     "/:id",
     verifyAdmin, // who is calling? (401 if nobody)
     canManageRoles, // requirePermission("ROLE") (403 if not allowed)
     validate({ params: roleIdParams, body: updateRoleBody }), // 400 if the input is wrong
     asyncHandler(controller.update)
   );
   ```

4. **`role.controller.ts`** takes the checked input from `req.validated` and calls the service:

   ```ts
   update = async (req: Request, res: Response) => {
     const { id } = req.validated.params as RoleIdParams;
     const input = req.validated.body as UpdateRoleBody;
     const data = await this.roleService.update(id, input, this.actor(req));
     res.status(200).json(new ApiResponse(200, data, "Role updated"));
   };
   ```

5. **`role.service.ts`** applies the rules: the role must exist (404), the super admin role can't be
   changed and nobody may edit their own role (403). Then it saves and clears the permission cache.
6. **`role.repository.ts`** runs the Prisma queries inside a transaction and returns only the
   selected fields.
7. **`errorHandler`** (`src/utils/errorHandler.ts`): if any step threw, it turns the error into a safe
   JSON reply. An `ApiError` keeps its status and message; anything unexpected becomes a plain
   500 "Internal Server Error", and the real error goes to the log only.

## How the pieces are wired

There is no dependency-injection library. Classes receive what they need through their constructor,
and three files put them together:

- **`src/modules/<panel>/<feature>/index.ts`** builds one module: repository → service → controller. It
  returns what other code needs (for example the service) and a `router(deps)` function.
- **`src/container.ts`** creates the shared pieces once (`infra` = Prisma, Redis, logger; the token
  service; rate limiters; storage) and then each module in one line:

  ```ts
  const session = createSessionModule(infra, { tokenService });
  const role = createRoleModule(infra);
  const adminAuth = createAdminAuthModule(infra, {
    sessionService: session.service,
    tokenService,
    googleTokenVerifier,
    permissionService: role.permissionService,
  });
  ```

  After the modules, it builds the guards (`verifyAdmin`, `verifyUser`, `requirePermission`, `requireOrganizationRole`),
  because the guards need the auth services.

- **`src/routes.ts`** mounts each module's router, one line each.

Tests use the same container with one part swapped (a fake Google token verifier),
so they run the real app.

## Rules you will meet

Some mistakes are stopped automatically, so you find out at once instead of in code review:

- `pnpm lint` fails if a controller or route imports Prisma, if code outside a module imports
  anything but its `index.js`, or if code reads `process.env` outside `src/config/env.ts`.
- `pnpm test` fails if any route has no guard, or if `.env.sample` is missing a variable.

The full list, with how each rule is enforced, is in `.claude/rules/core-rules.md`.

Next: [02 Module anatomy](02-module-anatomy.md).

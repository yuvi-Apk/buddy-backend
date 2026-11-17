---
paths:
  - "src/modules/**"
  - "src/container.ts"
  - "src/routes.ts"
  - "src/middlewares/**"
---

# Modules

Every feature lives in `src/modules/<panel>/<feature>/` (kebab-case, singular).
`src/modules/admin-panel/role/` is the reference for all of them.

## Panel folders

Pick the folder by who calls the module, before writing anything:

| Folder         | Holds modules used by      | Mounted under | Built                                           |
| -------------- | -------------------------- | ------------- | ----------------------------------------------- |
| `admin-panel/` | the super admin panel only | `/admin/...`  | `admin-account`, `admin-auth`, `role`, `upload` |
| `user-panel/`  | the user panel (app) only  | `/user/...`   | `user-auth`, `classroom`, `join-request`        |
| `shared/`      | both panels                | both          | `session`, `organization`, `invite`             |

- A module in `admin-panel/` or `user-panel/` has the six files below.
- A module in `shared/` has one schema, repository and service, and **splits the HTTP layer by panel**:
  `<feature>.admin.controller.ts` + `<feature>.admin.routes.ts` and `<feature>.user.controller.ts` +
  `<feature>.user.routes.ts` (classes `<Feature>AdminController` / `<Feature>UserController`,
  routers `create<Feature>AdminRouter` / `create<Feature>UserRouter`). `index.ts` builds both
  controllers and returns `adminRouter` and `userRouter`. Example: `src/modules/shared/invite/`.
  A shared module whose routes are identical for both panels (only the guards differ, like
  `session`) keeps one controller and one routes file.
- A module that starts in one panel and later gets routes in the other moves to `shared/` and splits.
- Imports between modules: `../role/index.js` in the same panel, `../../shared/session/index.js`
  from another panel. Deeper than `index.js` is blocked by ESLint (core-rules #6).
- Tests mirror the layout: `tests/modules/<panel>/<feature>.test.ts`.

| File                      | Job                                                                                          | May import                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `<feature>.schema.ts`     | Zod `strictObject` schemas for body, query, params; inferred types; `<Feature>Dto` interface | `zod`, `src/utils/pagination.ts`                                  |
| `<feature>.repository.ts` | Class. Database queries with explicit `select`                                               | Prisma                                                            |
| `<feature>.service.ts`    | Class. Rules, ownership checks, transactions, cache invalidation. Throws `ApiError`          | Its own repository, `core/`, other modules' `index.js` (types)    |
| `<feature>.controller.ts` | Class. Arrow-property methods: read `req.validated`, call the service, send `ApiResponse`    | Its service (type), `ApiResponse`, `ApiError`, its schema types   |
| `<feature>.routes.ts`     | `create<Feature>Router(controller, deps)`: path → guard(s) → `validate()` → `asyncHandler`   | Controller (type), middlewares, its schemas                       |
| `index.ts`                | `create<Feature>Module(infra, deps)`: builds repository → service → controller               | The five files above, `core/`, `module.types.ts`, `config/env.ts` |

## index.ts

```ts
export function createRoleModule({ prisma, redis }: Infra) {
  const repository = new RoleRepository(prisma);
  const permissionService = new PermissionService(repository, redis);
  const service = new RoleService(repository, permissionService);
  const controller = new RoleController(service);
  return {
    permissionService, // only what other modules need
    router: ({ guards }: RouterDeps) => createRoleRouter(controller, guards),
  };
}
export type RoleModule = ReturnType<typeof createRoleModule>;
export type { RoleDto } from "./role.schema.js"; // types other code needs
```

- `router` is a function because the guards are built after the modules (they need the auth services).
- Other code imports only from `index.js`: `import type { SessionService } from "../../shared/session/index.js"`.
- Never export the repository.

## Wiring

- `src/container.ts`: one line per module, after the modules it depends on:
  `const role = createRoleModule(infra);` then add it to `modules: { ... }`.
- `src/routes.ts`: one line per mount: `router.use("/admin/roles", modules.role.router(deps));`
  Admin modules mount under `/admin/<features>`, app modules under `/user/<features>`.

## Routes and guards

| Route is for                                       | Guards                                       |
| -------------------------------------------------- | -------------------------------------------- |
| Admin panel, a page in `src/config/rbac.config.ts` | `verifyAdmin`, `requirePermission("<PAGE>")` |
| Admin panel, one of several pages                  | `verifyAdmin`, `requireAnyPermission([...])` |
| Admin's own account (profile, own sessions)        | `verifyAdmin`, `ownAccountRoute()`           |
| Mobile app                                         | `verifyUser`                                 |
| Mobile app, inside one organization                | `verifyUser`, `requireOrganizationRole(...)` |
| Open on purpose (sign-in, refresh)                 | `publicRoute()`, plus `authRateLimit`        |

`requireOrganizationRole()` reads the `X-Organization-Id` header and sets `req.membership`; scope
every query by `req.membership.organizationId`. Fixed paths (`/pages`) go above parameter paths (`/:id`). A new admin page goes into `PAGES` in
`src/config/rbac.config.ts`.

## Controllers and responses

- Methods are arrow properties (`list = async (req, res) => {}`) so `this` survives being passed to a router.
- Input comes only from `req.validated`; the caller from `req.admin`, `req.user`, `req.membership` or `req.auth`.
- Success: `res.status(n).json(new ApiResponse(n, data, "message"))`, 201 for create, 200 otherwise.
- Expected failure: `throw ApiError.notFound(...)` (or `badRequest`, `unauthorized`, `forbidden`,
  `conflict`, `tooManyRequests`). Never build error JSON by hand.
- Imports end in `.js` (ESM), even though the files are `.ts`.
- Slow work (email, SMS, file processing, AI calls) does not run inside the request; see `ai.md` (A8).

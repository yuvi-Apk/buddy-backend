---
name: add-endpoint
description: Add one endpoint to an existing Buddy backend module, working through schema, repository, service, controller, route and test. Use when asked to add a route, API or action to a module that already exists.
---

# Add an endpoint

Work bottom-up through the module's files, so each layer is ready before the next one
uses it. `src/modules/admin-panel/role/` is the reference for every step; the rules are in
`.claude/rules/modules.md` and the full guide for people is `docs/04-add-an-endpoint.md`.

Modules sit in a panel folder: `src/modules/admin-panel/`, `user-panel/` or `shared/`.

- In a `shared/` module, the controller and route go in the file for the panel that calls the
  endpoint: `<feature>.admin.controller.ts` + `<feature>.admin.routes.ts`, or
  `<feature>.user.controller.ts` + `<feature>.user.routes.ts`. The schema, repository and service
  stay one file each.
- If the module is in `admin-panel/` or `user-panel/` and the new endpoint is for the **other**
  panel, stop and tell the user. The module must first move to `shared/` and split its controller
  and routes by panel (`.claude/rules/modules.md`, "Panel folders"), and its test file moves to
  `tests/modules/shared/`.

## Steps

1. **Schema** (`<feature>.schema.ts`): add a `z.strictObject` schema for each of body, query and
   params the endpoint reads, and export the inferred type. Reuse `paginationQuery` for lists.
2. **Repository** (`<feature>.repository.ts`): add the query with an explicit `select`.
   - Changing a balance, stock or counter: one conditional `updateMany`, then check `count`.
   - Several writes that must succeed together: `this.prisma.$transaction`.
3. **Service** (`<feature>.service.ts`): add the method with the rules.
   - Record fetched by ID: check that the caller may see it. Not theirs → `ApiError.notFound`.
   - Expected failures throw `ApiError` (`badRequest`, `notFound`, `conflict`, `forbidden`).
   - If the change affects cached data, invalidate the cache here (see `RoleService.update`).
4. **Controller** (`<feature>.controller.ts`, or `<feature>.<admin|user>.controller.ts` in `shared/`): add an arrow-property method. Input comes from
   `req.validated` only. The caller comes from `req.admin`, `req.user` or `req.auth`.
   Respond with `res.status(n).json(new ApiResponse(n, data, "message"))`: 201 for create,
   200 otherwise.
5. **Route** (`<feature>.routes.ts`, or `<feature>.<admin|user>.routes.ts` in `shared/`): add the route as guard(s) → `validate({...})` →
   `asyncHandler(controller.method)`. Fixed paths go above `/:id` paths.
6. **Test** (`tests/modules/<panel>/<feature>.test.ts`): add a `describe("<METHOD> <path>")` block
   with tests in the order guard (401/403) → 400 → 404 / not the owner → rule failures → success.
   Use `adminWith`, `superAdmin`, `signInUser` from `tests/helpers/auth.ts` and
   `expectAdminPageRequired` from `tests/helpers/guards.ts`.
7. **index.ts**: only if another module needs a new type, export it from `index.ts` with
   `export type`. The router function there already picks up the new route.

## Checklist before you hand over

- [ ] The route has a guard: `verifyAdmin` + `requirePermission(...)`, `verifyAdmin` +
      `ownAccountRoute()`, `verifyUser`, or `publicRoute()`
- [ ] The route has `validate()` for everything it reads, and the schemas are `strictObject`
- [ ] The controller does not touch `req.body`, `req.query` or `req.params`
- [ ] The controller and route do not import Prisma or a repository
- [ ] The repository query has an explicit `select` and returns no hash or secret
- [ ] A record looked up by ID is checked for ownership in the service
- [ ] A list endpoint is paginated
- [ ] Slow work (email, SMS, file processing, AI calls) is not done inside the request
- [ ] Tests cover: success, 401, 403, 400 for bad input and unknown fields, 404, not the owner
- [ ] Other modules are imported only through their `index.js`
- [ ] Every new variable, function, field and test title follows `.claude/rules/naming.md`
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] Stop and give the user the commit message (do not commit)

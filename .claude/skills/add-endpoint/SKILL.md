---
name: add-endpoint
description: Add one endpoint to an existing Buddy backend module, working through schema, repository, service, controller, route and test. Use when asked to add a route, API or action to a module that already exists.
---

# Add an endpoint

Work bottom-up through the module's five files, so each layer is ready before the next one
uses it. `src/modules/role/` is the reference for every step.

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
4. **Controller** (`<feature>.controller.ts`): add an arrow-property method. Input comes from
   `req.validated` only. The caller comes from `req.adminUser`, `req.user` or `req.auth`.
   Respond with `res.status(n).json(new ApiResponse(n, data, "message"))`: 201 for create,
   200 otherwise.
5. **Route** (`<feature>.routes.ts`): add the route as guard(s) → `validate({...})` →
   `asyncHandler(controller.method)`. Fixed paths go above `/:id` paths.
6. **Test** (`tests/<feature>.test.ts`): add tests for the endpoint.

## Checklist before you commit

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
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass

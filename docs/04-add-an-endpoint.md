# 04 Add an endpoint

This guide adds one route to a module that already exists. The example adds
`GET /admin/roles/:id/admins`, "list the admins who hold this role", to `src/modules/role/`. It is
only an example of the steps; it is not in the code.

Work **bottom-up**: schema → repository → service → controller → route → test. Each layer is then
ready before the next one uses it, and TypeScript tells you at once if something doesn't fit.

## Step 1. Schema

Add a schema for every part of the request the endpoint reads, and a type for what it returns.

```ts
// role.schema.ts
export const listRoleAdminsQuery = paginationQuery; // only page and limit
export type ListRoleAdminsQuery = z.infer<typeof listRoleAdminsQuery>;

export interface RoleAdminDto {
  id: string;
  name: string;
  email: string;
}
```

The `:id` part reuses the existing `roleIdParams`.

## Step 2. Repository

Add the query, with an explicit `select`. Return no hashes or secrets.

```ts
// role.repository.ts
async listAdmins(roleId: string, query: ListRoleAdminsQuery) {
  const where = { roleId };
  const [items, total] = await Promise.all([
    this.prisma.adminUser.findMany({
      where,
      select: { id: true, name: true, email: true }, // never passwordHash
      orderBy: { name: "asc" },
      ...toSkipTake(query),
    }),
    this.prisma.adminUser.count({ where }),
  ]);
  return { items, total };
}
```

Changing a balance or counter? Use the atomic pattern in [06 Database](06-database.md).

## Step 3. Service

Add the method with the rules. Check that the record exists (and belongs to the caller, when rows
have an owner) before doing anything else.

```ts
// role.service.ts
async listAdmins(id: string, query: ListRoleAdminsQuery): Promise<Paginated<RoleAdminDto>> {
  await this.getById(id); // 404 if the role doesn't exist
  const { items, total } = await this.roles.listAdmins(id, query);
  return paginated(items, total, query);
}
```

If the change affects cached data, clear the cache here (as `RoleService.update` does with
`this.permissions.invalidate(id)`).

## Step 4. Controller

Add an arrow-property method. Input only from `req.validated`.

```ts
// role.controller.ts
listAdmins = async (req: Request, res: Response) => {
  const { id } = req.validated.params as RoleIdParams;
  const query = req.validated.query as ListRoleAdminsQuery;
  const data = await this.roleService.listAdmins(id, query);
  res.status(200).json(new ApiResponse(200, data, "Admins fetched"));
};
```

## Step 5. Route

Guard(s) → `validate()` → `asyncHandler(controller.method)`. Put fixed paths above `/:id` paths.

```ts
// role.routes.ts
router.get(
  "/:id/admins",
  verifyAdmin,
  canManageRoles,
  validate({ params: roleIdParams, query: listRoleAdminsQuery }),
  asyncHandler(controller.listAdmins)
);
```

Nothing to change in `index.ts`, `container.ts` or `routes.ts`: the module's router already includes
the new route. Only export a new type from `index.ts` if another module needs it.

## Step 6. Test

Add a `describe` block for the endpoint to `tests/modules/role.test.ts`, and add the route to the
list in the module's "guards" block so the 401/403 checks cover it.

```ts
describe("GET /admin/roles/:id/admins", () => {
  it("400 for a malformed ID and for limit above 100", async () => {
    const { auth } = await superAdmin();
    expect(
      (await request(app).get(`${ROLES}/not-a-uuid/admins`).set(auth)).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`${ROLES}/${MISSING_ID}/admins?limit=101`)
          .set(auth)
      ).status
    ).toBe(400);
  });

  it("404 for a missing role", async () => {
    const { auth } = await superAdmin();
    expect(
      (await request(app).get(`${ROLES}/${MISSING_ID}/admins`).set(auth)).status
    ).toBe(404);
  });

  it("200 lists the role's admins without password hashes", async () => {
    const boss = await superAdmin();
    const staff = await adminWith(["UPLOAD"]);
    const res = await request(app)
      .get(`${ROLES}/${staff.role.id}/admins`)
      .set(boss.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([
      { id: staff.admin.id, name: "Test Admin", email: "staff@buddy.test" },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });
});
```

## Step 7. Check and hand over

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Checklist:

- [ ] The route has a guard and `validate()` for everything it reads
- [ ] The controller doesn't touch `req.body`, `req.query` or `req.params`
- [ ] The repository query has an explicit `select`
- [ ] Records looked up by ID are checked in the service (404 if missing or not the caller's)
- [ ] A list endpoint is paginated
- [ ] Slow work (email, SMS, AI calls, file processing) is not done inside the request
- [ ] Tests for 401, 403, 400 (bad input and unknown field), 404, not the owner, success

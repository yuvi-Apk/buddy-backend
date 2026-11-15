# 02 Module anatomy

Every module in `src/modules/<feature>/` has exactly these six files. The examples are real code
from `src/modules/role/`, shortened.

| File                      | Job                                            | May import                                         |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `<feature>.schema.ts`     | What input is allowed, what output looks like  | `zod`, pagination helper                           |
| `<feature>.repository.ts` | Database queries                               | Prisma                                             |
| `<feature>.service.ts`    | Business rules                                 | Its repository, `core/`, other modules' `index.js` |
| `<feature>.controller.ts` | HTTP in, HTTP out                              | Its service, `ApiResponse`, `ApiError`             |
| `<feature>.routes.ts`     | Paths, guards, input checks                    | Controller, middlewares, its schemas               |
| `index.ts`                | Builds the module; the only file others import | The five files above                               |

Naming: folder and files in kebab-case and singular (`learning-path`), classes in PascalCase
(`LearningPathService`). Imports end in `.js` even though the files are `.ts`.

## schema.ts: what may come in

Zod schemas for each part of the request, plus the types inferred from them. Always use
`z.strictObject`, so a request with an unknown field (for example `isSuperAdmin: true`) is
rejected instead of silently passed on.

```ts
export const createRoleBody = z.strictObject({
  name: roleName,
  description: z.string().trim().max(255).optional(),
  pages: pages.default([]),
});
export type CreateRoleBody = z.infer<typeof createRoleBody>;

export const roleIdParams = z.strictObject({ id: z.uuid() });

// List endpoints extend the shared pagination schema (page, limit up to 100).
export const listRolesQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(50).optional(),
});

/** What the API returns for a role. */
export interface RoleDto {
  id: string;
  name: string;
  description: string | null;
  pages: string[];
  createdAt: Date;
  updatedAt: Date;
}
```

## repository.ts: talk to the database

A class that receives the Prisma client in its constructor. It is the only kind of file allowed to
use Prisma. Every query names its fields with `select`, so a new column (or a password hash) never
leaks into a response by accident.

```ts
const roleSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  permissions: { where: { isAccess: true }, select: { page: true } },
} as const;

export class RoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<RoleDto | null> {
    const row = await this.prisma.role.findUnique({
      where: { id },
      select: roleSelect,
    });
    return row ? toDto(row) : null;
  }
}
```

No rules here: the repository doesn't decide whether something is allowed, it only reads and writes.

## service.ts: the rules

A class that receives its repository (and anything else it needs) in the constructor. This is where
"is this allowed?" is answered. Expected failures throw `ApiError`; the error handler turns them into
the right response.

```ts
export class RoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly permissions: PermissionService
  ) {}

  async getById(id: string): Promise<RoleDto> {
    const role = await this.roles.findById(id);
    if (!role) throw ApiError.notFound("Role not found");
    return role;
  }

  async update(id: string, input: UpdateRoleBody, actor: AuthenticatedAdmin) {
    const role = await this.getById(id);
    this.assertCanChange(role, actor); // 403 for SUPER_ADMIN or your own role
    const updated = await this.roles.update(id, input);
    await this.permissions.invalidate(id); // cached permissions change at once
    return updated;
  }
}
```

The service never touches `req` or `res`, so it can be called from a background job or another
module just as well as from a route. To use another module, receive its **service** (not its
repository) and import its type from that module's `index.js`.

## controller.ts: HTTP in, HTTP out

A class whose methods are **arrow properties**, so `this` still works when the method is handed to
the router. Each method reads the checked input, calls one service method and sends the response.

```ts
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  create = async (req: Request, res: Response) => {
    const input = req.validated.body as CreateRoleBody;
    const data = await this.roleService.create(input);
    res.status(201).json(new ApiResponse(201, data, "Role created"));
  };
}
```

- Input only from `req.validated` (never `req.body`, `req.query`, `req.params`).
- The caller from `req.adminUser` (admin routes) or `req.user` (app routes).
- 201 for create, 200 for everything else.

## routes.ts: paths and guards

A function that builds an Express router. Every route lists, in this order: guard(s), `validate()`,
then the controller method wrapped in `asyncHandler` (so a thrown error reaches the error handler).

```ts
export function createRoleRouter(
  controller: RoleController,
  { verifyAdmin, requirePermission }: Deps
) {
  const router = Router();
  const canManageRoles = requirePermission("ROLE");

  router.get(
    "/",
    verifyAdmin,
    canManageRoles,
    validate({ query: listRolesQuery }),
    asyncHandler(controller.list)
  );

  // Must stay above "/:id", or "pages" would be read as an ID.
  router.get("/pages", verifyAdmin, canManageRoles, controller.listPages);

  router.get(
    "/:id",
    verifyAdmin,
    canManageRoles,
    validate({ params: roleIdParams }),
    asyncHandler(controller.getById)
  );
  return router;
}
```

Which guard to use is explained in [05 Auth and permissions](05-auth-and-permissions.md).

## index.ts: build the module

Creates the module's classes in order and returns only what the rest of the app needs. Other code
imports **only** from this file; ESLint blocks `../role/role.service.js` from outside the module.

```ts
export function createRoleModule({ prisma, redis }: Infra) {
  const repository = new RoleRepository(prisma);
  const permissionService = new PermissionService(repository, redis);
  const service = new RoleService(repository, permissionService);
  const controller = new RoleController(service);

  return {
    permissionService,
    router: ({ guards }: RouterDeps) => createRoleRouter(controller, guards),
  };
}

export type RoleModule = ReturnType<typeof createRoleModule>;
export type { RoleDto } from "./role.schema.js";
```

`router` is a function rather than a ready router because the guards are created after the modules
(the guards need the auth modules' services).

Next: [03 Create a module](03-create-a-module.md).

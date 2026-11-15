# 03 Create a module

This guide builds a new feature from nothing. The example is a `school` module that admins manage
from the admin panel. It is only an example of the steps: it does not exist in the code yet.

Before you start, answer three questions. They decide what you write:

1. **Who calls it?** The admin panel (`/admin/...`, `verifyAdmin` + a page), the mobile app
   (`/user/...`, `verifyUser`), or both (two routers).
2. **Which table(s) does it own?** Each table belongs to exactly one module.
3. **Do the rows belong to someone?** (a school, a user). If so, every read or change by ID must
   check ownership in the service, and someone else's record answers **404**.

Work through the steps in order; each step only uses what the earlier steps made.

## Step 1. Database table

Add the model to `prisma/schema.prisma`:

```prisma
model School {
  id        String   @id @default(uuid())
  name      String   @unique
  city      String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Create the migration and add the table to the test reset list:

```bash
pnpm exec prisma migrate dev --name add_school
```

```ts
// tests/helpers/testApp.ts, in resetState()
await prisma.$executeRaw`TRUNCATE TABLE "School", "UploadedFile", "Session", ... CASCADE`;
```

Tables that belong to a school later get a required `schoolId` column with `@@index([schoolId])`.

## Step 2. `school.schema.ts`

```ts
import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

export const createSchoolBody = z.strictObject({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().max(80).optional(),
});
export type CreateSchoolBody = z.infer<typeof createSchoolBody>;

export const schoolIdParams = z.strictObject({ id: z.uuid() });
export type SchoolIdParams = z.infer<typeof schoolIdParams>;

export const listSchoolsQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(50).optional(),
});
export type ListSchoolsQuery = z.infer<typeof listSchoolsQuery>;

export interface SchoolDto {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
  createdAt: Date;
}
```

## Step 3. `school.repository.ts`

```ts
import type { PrismaClient } from "../../config/prisma.js";
import { toSkipTake } from "../../utils/pagination.js";
import type {
  CreateSchoolBody,
  ListSchoolsQuery,
  SchoolDto,
} from "./school.schema.js";

const schoolSelect = {
  id: true,
  name: true,
  city: true,
  isActive: true,
  createdAt: true,
} as const;

export class SchoolRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    query: ListSchoolsQuery
  ): Promise<{ items: SchoolDto[]; total: number }> {
    const where = query.search
      ? { name: { contains: query.search, mode: "insensitive" as const } }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.school.findMany({
        where,
        select: schoolSelect,
        orderBy: { name: "asc" },
        ...toSkipTake(query),
      }),
      this.prisma.school.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string): Promise<SchoolDto | null> {
    return this.prisma.school.findUnique({
      where: { id },
      select: schoolSelect,
    });
  }

  create(input: CreateSchoolBody): Promise<SchoolDto> {
    return this.prisma.school.create({ data: input, select: schoolSelect });
  }
}
```

## Step 4. `school.service.ts`

```ts
import { ApiError } from "../../utils/ApiError.js";
import { paginated, type Paginated } from "../../utils/pagination.js";
import type { SchoolRepository } from "./school.repository.js";
import type {
  CreateSchoolBody,
  ListSchoolsQuery,
  SchoolDto,
} from "./school.schema.js";

export class SchoolService {
  constructor(private readonly schools: SchoolRepository) {}

  async list(query: ListSchoolsQuery): Promise<Paginated<SchoolDto>> {
    const { items, total } = await this.schools.list(query);
    return paginated(items, total, query);
  }

  async getById(id: string): Promise<SchoolDto> {
    const school = await this.schools.findById(id);
    if (!school) throw ApiError.notFound("School not found");
    return school;
  }

  // A duplicate name hits the unique index; errorHandler turns that into a 409.
  create(input: CreateSchoolBody): Promise<SchoolDto> {
    return this.schools.create(input);
  }
}
```

## Step 5. `school.controller.ts`

```ts
import type { Request, Response } from "express";
import { ApiResponse } from "../../utils/ApiResponse.js";
import type {
  CreateSchoolBody,
  ListSchoolsQuery,
  SchoolIdParams,
} from "./school.schema.js";
import type { SchoolService } from "./school.service.js";

export class SchoolController {
  constructor(private readonly schoolService: SchoolService) {}

  list = async (req: Request, res: Response) => {
    const data = await this.schoolService.list(
      req.validated.query as ListSchoolsQuery
    );
    res.status(200).json(new ApiResponse(200, data, "Schools fetched"));
  };

  getById = async (req: Request, res: Response) => {
    const { id } = req.validated.params as SchoolIdParams;
    const data = await this.schoolService.getById(id);
    res.status(200).json(new ApiResponse(200, data, "School fetched"));
  };

  create = async (req: Request, res: Response) => {
    const data = await this.schoolService.create(
      req.validated.body as CreateSchoolBody
    );
    res.status(201).json(new ApiResponse(201, data, "School created"));
  };
}
```

## Step 6. `school.routes.ts`

```ts
import { Router } from "express";
import { validate } from "../../middlewares/validate.middleware.js";
import type { Guards } from "../../types/module.types.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { SchoolController } from "./school.controller.js";
import {
  createSchoolBody,
  listSchoolsQuery,
  schoolIdParams,
} from "./school.schema.js";

export function createSchoolRouter(
  controller: SchoolController,
  {
    verifyAdmin,
    requirePermission,
  }: Pick<Guards, "verifyAdmin" | "requirePermission">
): Router {
  const router = Router();
  const canManageSchools = requirePermission("SCHOOL");

  router.get(
    "/",
    verifyAdmin,
    canManageSchools,
    validate({ query: listSchoolsQuery }),
    asyncHandler(controller.list)
  );
  router.get(
    "/:id",
    verifyAdmin,
    canManageSchools,
    validate({ params: schoolIdParams }),
    asyncHandler(controller.getById)
  );
  router.post(
    "/",
    verifyAdmin,
    canManageSchools,
    validate({ body: createSchoolBody }),
    asyncHandler(controller.create)
  );

  return router;
}
```

## Step 7. Permission page

Admin routes need a page. Add it in `src/config/rbac.config.ts`:

```ts
export const PAGES = ["ROLE", "UPLOAD", "SCHOOL"] as const;
```

Two tests list every page and need the new one: search for `["ROLE", "UPLOAD"]` in
`tests/modules/role.test.ts` and `tests/modules/admin-auth.test.ts`.

## Step 8. `index.ts`

```ts
// Public entry point of the school module. Other code imports from here only.
import type { Infra, RouterDeps } from "../../types/module.types.js";
import { SchoolController } from "./school.controller.js";
import { SchoolRepository } from "./school.repository.js";
import { createSchoolRouter } from "./school.routes.js";
import { SchoolService } from "./school.service.js";

export function createSchoolModule({ prisma }: Infra) {
  const repository = new SchoolRepository(prisma);
  const service = new SchoolService(repository);
  const controller = new SchoolController(service);

  return {
    service, // other modules (classroom, student) will need it
    router: ({ guards }: RouterDeps) => createSchoolRouter(controller, guards),
  };
}

export type SchoolModule = ReturnType<typeof createSchoolModule>;
export type { SchoolService } from "./school.service.js";
export type { SchoolDto } from "./school.schema.js";
```

## Step 9. Wire it

`src/container.ts`, one line after the modules it depends on, and add it to `modules`:

```ts
const school = createSchoolModule(infra);
// ...
modules: { session, role, adminAuth, userAuth, upload, school },
```

`src/routes.ts`, one line:

```ts
router.use("/admin/schools", modules.school.router(deps));
```

## Step 10. Tests

Create `tests/modules/school.test.ts` with one `describe` per endpoint (see [07 Testing](07-testing.md)):

```ts
describe("guards on /admin/schools", () => {
  it("401 without a login and 403 without the SCHOOL page, on every route", async () => {
    await expectAdminPageRequired(
      [
        ["get", SCHOOLS],
        ["get", `${SCHOOLS}/${MISSING_ID}`],
        ["post", SCHOOLS],
      ],
      "SCHOOL"
    );
  });
});

describe("POST /admin/schools", () => {
  it("400 for bad input and unknown fields", async () => {
    /* ... */
  });
  it("409 for a duplicate name", async () => {
    /* ... */
  });
  it("201 creates the school", async () => {
    /* ... */
  });
});
```

## Step 11. Check and hand over

```bash
pnpm lint && pnpm typecheck && pnpm test
```

If a route has no guard, `tests/guardrails/route-guards.test.ts` fails and names it. If a file
imports something it shouldn't, `pnpm lint` says which rule and why. When everything passes, commit
with a message that says what you added and why.

Checklist:

- [ ] Six files, and other code imports only `index.js`
- [ ] Every route: guard → `validate()` → `asyncHandler(...)`; fixed paths above `/:id`
- [ ] Schemas use `z.strictObject`; lists extend `paginationQuery`
- [ ] Every query has an explicit `select`; no hashes or secrets returned
- [ ] Ownership checked in the service for every read or change by ID
- [ ] New page in `PAGES`, new table in the test `TRUNCATE` list
- [ ] Tests for 401, 403, 400, 404, not the owner, and success

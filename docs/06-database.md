# 06 Database

PostgreSQL holds all records, through Prisma 7. Redis holds only short-lived things: sessions,
login codes, rate-limit counters and the permission cache. The schema is in `prisma/schema.prisma`,
and the generated client in `src/generated/prisma/` (never edit it).

## Only repositories use Prisma

`pnpm lint` fails if a controller, route, schema, service or middleware imports Prisma. Everything
that needs data asks a service, and the service asks its repository.

## Always `select`

Name the fields every query returns:

```ts
const schoolSelect = { id: true, name: true, city: true, createdAt: true } as const;

findById(id: string) {
  return this.prisma.school.findUnique({ where: { id }, select: schoolSelect });
}
```

Without `select`, Prisma returns every column, and a column added later (a token hash, an
internal note) would reach the API without anyone noticing. A method that must return a secret
says so in its name, such as `findPreviousRefreshTokenHash`, and its result never goes into a response.

## Lists are paginated

List queries extend `paginationQuery` (`page` from 1, `limit` 1–100, default 20). Use the helpers
from `src/utils/pagination.ts`:

```ts
// repository
this.prisma.school.findMany({
  where,
  select,
  orderBy: { name: "asc" },
  ...toSkipTake(query),
});

// service
return paginated(items, total, query); // { items, meta: { page, limit, total, totalPages } }
```

## Several writes together: a transaction

When writes must all succeed or all fail, use `$transaction`, as `RoleRepository.update` does:

```ts
const row = await this.prisma.$transaction(async (tx) => {
  await tx.rolePermission.deleteMany({ where: { roleId: id } });
  await tx.rolePermission.createMany({
    data: pages.map((page) => ({ roleId: id, page, isAccess: true })),
  });
  return tx.role.update({ where: { id }, data: fields, select: roleSelect });
});
```

## Balances, stock and counters: one statement

Never read a number, change it in code, and save it back. Two requests at the same moment both read
the old value, and both succeed. That is how the old project's wallets were overspent.

Instead, put the check in the `WHERE` clause and change the value in the same statement:

```ts
const { count } = await this.prisma.wallet.updateMany({
  where: { id: walletId, balance: { gte: amount } }, // the check
  data: { balance: { decrement: amount } }, // the change
});
if (count === 0) throw ApiError.conflict("Insufficient balance");
```

The database runs it as one step, so only one of two parallel requests can pass. Refresh-token
rotation (`SessionRepository`) uses the same pattern.

## Errors from the database

You rarely need to catch Prisma errors. `errorHandler` turns them into safe answers without database
details: a duplicate unique value becomes **409**, a missing record on update or delete **404**, and
a broken reference **409**. Check expected cases in the service and throw `ApiError` with a clear
message instead (for example "This role is assigned to admins").

Never build SQL from strings. `$queryRawUnsafe` and `$executeRawUnsafe` are blocked by ESLint;
when Prisma can't express a query, use the tagged form, which escapes values for you:
``this.prisma.$queryRaw`SELECT ... WHERE id = ${id}` ``.

## Changing the schema

```bash
# 1. edit prisma/schema.prisma
pnpm exec prisma migrate dev --name add_school   # 2. creates and applies a migration
```

- Commit the new folder under `prisma/migrations/` with your change.
- Never edit a migration that has already been applied; add a new one.
- Never run `prisma db push` or `prisma migrate reset`. They skip or erase migration history.
- Add each new table to the `TRUNCATE` list in `tests/helpers/testApp.ts`, or tests will leak
  data into each other.
- Tables that belong to an organization get a required `organizationId` with an index, and their
  repository methods take `organizationId` as a required argument.

## Seed

`pnpm db:seed` runs `prisma/seed.ts`. It creates the `SUPER_ADMIN` role and the first admin from
`SEED_SUPER_ADMIN_EMAIL`, who then signs in with that Google account. It is safe to run more than once; keep any
seed you add that way.

## Looking at the data

`pnpm exec prisma studio` opens a table browser at `http://localhost:5555`. Tests use a separate
database, `buddy_test`, so they never touch your development data.

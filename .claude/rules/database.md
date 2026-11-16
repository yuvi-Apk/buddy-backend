---
paths:
  - "prisma/**"
  - "src/**/*.repository.ts"
  - "src/config/prisma.ts"
---

# Database

## Queries

- Every query has an explicit `select`. Never return a whole row (core-rules #9).
- Never return a token hash unless the method name says so (`findPreviousRefreshTokenHash`).
- Organization-owned tables get a required `organizationId` column with an index, and every
  repository method for them takes `organizationId` as a required argument.
- Several writes that must succeed together: `this.prisma.$transaction(...)`.
- No `$queryRawUnsafe` / `$executeRawUnsafe`. Tagged `$queryRaw\`...\`` is allowed when Prisma can't express a query.

## Atomic update pattern (balances, stock, counters)

```ts
// One statement: the WHERE clause is the check. Two parallel requests cannot both pass.
const { count } = await prisma.wallet.updateMany({
  where: { id: walletId, balance: { gte: amount } },
  data: { balance: { decrement: amount } },
});
if (count === 0) throw new ApiError(409, "Insufficient balance");
```

Never read a value, change it in code, and write it back.

## Naming

Follow `naming.md`: short plain model names (`Invite`, `JoinRequest`), the `Admin` prefix only for
super admin panel staff. Only tables are mapped (`@@map("join_requests")`); columns and enums keep
their Prisma names. In tagged `$queryRaw`, quote camelCase columns:
`SELECT id FROM admins WHERE id = ${adminId} FOR UPDATE`, `WHERE "organizationId" = ${organizationId}`.

## Migrations

- Change `prisma/schema.prisma`, then `pnpm exec prisma migrate dev --name <what_changed>`.
- Never run `prisma db push` or `prisma migrate reset`. Never edit an applied migration; add a new one.
- After adding a table, add it to the `TRUNCATE` list in `tests/helpers/testApp.ts`.
- `prisma/seed.ts` must stay idempotent (safe to run twice).

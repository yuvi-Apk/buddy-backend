# Buddy backend

Backend for an AI education platform: a mobile app for students and an admin panel for staff.
Node 22, pnpm, TypeScript (ESM), Express 5, Prisma 7 + PostgreSQL, Redis, Zod, Vitest.

Read `docs/RULES.md` (the rules and how each is enforced) and `docs/ARCHITECTURE.md` (where code goes) before changing code.

## Commands

| Task                     | Command                                              |
| ------------------------ | ---------------------------------------------------- |
| Start Postgres and Redis | `docker compose up -d`                               |
| Dev server               | `pnpm dev`                                           |
| Lint / types / tests     | `pnpm lint` / `pnpm typecheck` / `pnpm test`         |
| One test file            | `pnpm test tests/path/file.test.ts`                  |
| New migration            | `pnpm exec prisma migrate dev --name <what_changed>` |
| Regenerate Prisma client | `pnpm exec prisma generate`                          |

## How to build a feature

- New feature folder: use the `new-module` skill.
- New endpoint in an existing module: use the `add-endpoint` skill.
- Every module has exactly five files: `routes`, `controller`, `service`, `repository`, `schema`.
- Classes get their dependencies through the constructor. Create and wire them only in `src/container.ts`.
- Controller methods are arrow properties (`list = async (req, res) => {}`) so `this` survives being passed to a router.
- Throw `ApiError` for expected failures. Return `new ApiResponse(status, data, message)`. Never build error JSON by hand.
- Imports end in `.js` (ESM), even though the files are `.ts`.

## Don'ts

- Don't import Prisma outside a `*.repository.ts` file. Controllers and middlewares call services.
- Don't import another module's repository. Call its service.
- Don't read `process.env`. Import `env` from `src/config/env.ts`.
- Don't add a route without a guard. Use `verifyAdmin` + `requirePermission(...)`, `verifyUser`, or mark it `publicRoute()`.
- Don't read `req.body`, `req.query` or `req.params` without a `validate()` schema on the route.
- Don't return a whole Prisma row. Repositories use explicit `select`; never return password, OTP or token hashes.
- Don't send `err.message`, stack traces or Prisma errors to the client. Don't log tokens, OTPs or passwords.
- Don't read a value and then write it back for balances or counters. Use the atomic pattern below.
- Don't use `$queryRawUnsafe` / `$executeRawUnsafe`, `any`, `console.log`, or un-awaited promises.
- Don't run `prisma db push` or `prisma migrate reset`. Don't edit an applied migration; add a new one.
- Don't keep state in module-level variables (caches, counters). Use Redis.
- Don't add a package unless nothing in Node or the current dependencies can do the job. State the reason in the commit.
- Don't call a model provider or Qdrant outside `src/core/ai` (see the AI rules in `docs/RULES.md`).

## Atomic update pattern (balances, stock, counters)

```ts
// One statement: the WHERE clause is the check. Two parallel requests cannot both pass.
const { count } = await prisma.wallet.updateMany({
  where: { id: walletId, balance: { gte: amount } },
  data: { balance: { decrement: amount } },
});
if (count === 0) throw new ApiError(409, "Insufficient balance");
```

## Env files

- Never read or edit `.env`. It is blocked in `.claude/settings.json`.
- To add a variable: add it to the Zod schema in `src/config/env.ts`, add it to `.env.sample` and `.env.test`,
  then tell the user the variable name so they can put the real value in `.env`.
- `tests/guardrails/env-sample.test.ts` fails if `.env.sample` and the schema list different keys.

## Definition of done

A change is done when all of these are true:

1. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.
2. New behaviour has a test, including the failure cases (401, 403, 400, not found, not the owner).
3. Every new route has a guard and a `validate()` schema.
4. New env variables are in the schema, `.env.sample` and `.env.test`, and the user has been told.
5. No rule in `docs/RULES.md` is broken.
6. The work is committed with a message that says what changed and why.

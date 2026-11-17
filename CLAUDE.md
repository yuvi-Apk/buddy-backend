# Buddy backend

Backend for an AI education platform: a user panel (app) and a super admin panel, both with Google sign-in.
Node 22, pnpm, TypeScript (ESM), Express 5, Prisma 7 + PostgreSQL, Redis, Zod, Vitest.

Rules live in `.claude/rules/`. `core-rules.md` is always loaded; the others load when you work on
matching files (architecture, modules, database, testing, env, ai). Developer guides are in `docs/`.

## Commands

| Task                     | Command                                              |
| ------------------------ | ---------------------------------------------------- |
| Start Postgres and Redis | `docker compose up -d`                               |
| Dev server               | `pnpm dev`                                           |
| Lint / types / tests     | `pnpm lint` / `pnpm typecheck` / `pnpm test`         |
| One test file            | `pnpm test tests/modules/admin-panel/role.test.ts`   |
| New migration            | `pnpm exec prisma migrate dev --name <what_changed>` |

## Building

- New feature folder: use the `new-module` skill. New endpoint in an existing module: use `add-endpoint`.
  Tests for code that already exists (for example written by hand): use `write-tests`.
- A module is six files (`routes`, `controller`, `service`, `repository`, `schema`, `index.ts`). Copy `src/modules/admin-panel/role/`.
- Names say what a thing holds or does. Comments: `//` only, short, for _why_ not _what_; major
  sections get a `// ====` banner. Details in `.claude/rules/naming.md`.

## Never

- Prisma outside `*.repository.ts`, or another module's files except its `index.js`.
- A route without a guard, or input read without `validate()` (`req.validated` only).
- `process.env` outside `src/config/env.ts`; reading or editing `.env`.
- A whole Prisma row, a hash, `err.message` or a stack trace in a response; a secret in a log.
- Read-then-write for balances or counters (use the atomic pattern in `database.md`).
- `prisma db push`, `prisma migrate reset`, or editing an applied migration.
- `any`, `console.log`, un-awaited promises, state in module-level variables, a package without a reason.
- `git add` or `git commit` (see below).

## Definition of done

1. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.
2. New behaviour has tests, including 401, 403, 400, 404 and "not the owner".
3. Every new route has a guard and a `validate()` schema.
4. New env variables are in the schema, `.env.sample` and `.env.test`, and the user has been told the name.
5. No rule in `.claude/rules/` is broken.

## Commits

Never commit. When a step is done and the checks pass, stop: list the changed files, give a commit
message that says what changed and why (ending with the `Co-Authored-By` line), and wait. The user
reviews and commits, then tells you to continue.

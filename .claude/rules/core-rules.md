# Core rules

Each rule comes from a real problem in the old project or a known security risk. Code comments and
ESLint messages refer to them as "core-rules #N". A rule enforced only "by review" must be checked
by hand before handing over a change.

| #   | Rule                                                                                                                                                              | Enforced by                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Every route requires login unless it is marked `publicRoute()`. Every admin route also declares `requirePermission`, `requireAnyPermission` or `ownAccountRoute`. | Router setup + `tests/guardrails/route-guards.test.ts`      |
| 2   | Env is read only in `src/config/env.ts` and validated at boot. The app refuses to start on a bad or missing value.                                                | Zod + ESLint ban on `process.env` + `.env.sample` sync test |
| 3   | Money and counters change in one conditional statement (`updateMany where balance >= amount`, then check `count`). Never read, then write.                        | Pattern in `database.md`, review                            |
| 4   | Logout and revocation take effect on the next request.                                                                                                            | Session check on every request + tests                      |
| 5   | Only `*.repository.ts` files import Prisma. Controllers, routes, schemas and middlewares never do.                                                                | ESLint `no-restricted-imports` + guardrail test             |
| 6   | Code outside a module imports it only through its `index.js`. A module never uses another module's repository; it calls that module's service.                    | ESLint `no-restricted-imports` + guardrail test             |
| 7   | All input (body, query, params) passes a Zod `strictObject` schema through `validate()`. Unknown keys are rejected.                                               | `validate()` middleware                                     |
| 8   | Ownership is checked in the service every time a record is read or changed by ID. Someone else's record answers 404, not 403.                                     | Skill checklist + tests                                     |
| 9   | Repositories return explicit `select` lists. A password, OTP or token hash never leaves a repository unless the method name says so (`findWithPasswordHash`).     | Repository pattern + tests                                  |
| 10  | Errors return a safe message. No stack trace, Prisma object or raw `err.message` reaches the client.                                                              | `errorHandler` + tests                                      |
| 11  | Secrets, tokens, OTPs and passwords never appear in logs.                                                                                                         | `pino` redaction list + `tests/platform/logging.test.ts`    |
| 12  | Passwords are hashed with scrypt. Refresh tokens and OTPs are stored hashed.                                                                                      | `PasswordHasher`, `TokenService`, `OtpService`              |
| 13  | Login, OTP and refresh endpoints have strict rate limits. OTP has an attempt limit and a resend cooldown.                                                         | Redis rate limiters + tests                                 |
| 14  | Auth failures give the same message whether or not the account exists.                                                                                            | Tests                                                       |
| 15  | Uploads have size, count and type limits. Filenames are generated. A file path can never leave the upload folder.                                                 | Upload middleware, `deleteLocalFile` + tests                |
| 16  | List endpoints are paginated with a hard maximum page size (100).                                                                                                 | `paginationQuery` in `src/utils/pagination.ts`              |
| 17  | CORS uses an allowlist from env. Body size is capped. `helmet` is on.                                                                                             | `src/app.ts` + tests                                        |
| 18  | No raw SQL built from strings (`$queryRawUnsafe`, `$executeRawUnsafe`).                                                                                           | ESLint `no-restricted-syntax` + guardrail test              |
| 19  | Schema changes go through Prisma migrations. No `db push`, no `migrate reset`, no editing an applied migration.                                                   | Blocked in `.claude/settings.json`                          |
| 20  | The API keeps no state in process memory, so any number of instances can run.                                                                                     | Redis for shared state, review                              |
| 21  | No new package unless nothing in Node or the current dependencies can do the job. The reason goes in the commit message.                                          | Review                                                      |
| 22  | No `any`, no floating promises, no `console.log`.                                                                                                                 | ESLint                                                      |
| 23  | A change is done only when `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.                                                                                    | Definition of done in `CLAUDE.md`                           |
| 24  | Names say what a thing holds or does. Short plain models (`Invite`); tables plural snake_case via `@@map`; columns and enums not mapped. See `naming.md`.         | `naming.md`, review                                         |
| 25  | Comments use `//` only, short, and explain _why_. Major sections get a `// ====` banner. No commented-out code.                                                   | `naming.md`, review                                         |

Naming and comment rules (#24, #25) are in `naming.md`. AI features have their own rules (A1–A8) in `ai.md`.

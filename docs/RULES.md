# Rules

Every rule here exists because of a real problem in the old project or a known security risk.
Each rule says how it is enforced. If a rule is enforced only "by review", check it by hand before you commit.

## Core rules

| #   | Rule                                                                                                                                                               | Enforced by                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1   | Every route requires login unless it is marked `publicRoute()`. Every admin route also declares `requirePermission` or `requireAnyPermission`.                     | Router setup + route-table test                             |
| 2   | Env is read only in `src/config/env.ts` and validated at boot. The app refuses to start on a bad or missing value.                                                 | Zod + ESLint ban on `process.env` + `.env.sample` sync test |
| 3   | Money and counters change in one conditional statement (`updateMany where balance >= amount`, then check the count). Never read, then write.                       | Pattern in `CLAUDE.md`, review                              |
| 4   | Logout and revocation take effect on the next request.                                                                                                             | Session check on every request + test                       |
| 5   | Only `*.repository.ts` files import Prisma. Controllers, routes, schemas and middlewares never do.                                                                 | ESLint `no-restricted-imports` + `tests/guardrails`         |
| 6   | A module never imports another module's repository. It calls that module's service.                                                                                | ESLint `no-restricted-imports` + `tests/guardrails`         |
| 7   | All input (body, query, params) passes a Zod schema. Unknown keys are rejected.                                                                                    | `validate()` middleware                                     |
| 8   | Ownership is checked in the service every time a record is read or changed by ID.                                                                                  | Skill checklist + tests                                     |
| 9   | Repositories return explicit `select` lists. A password hash, OTP or token hash never leaves a repository unless the method name says so (`findWithPasswordHash`). | Repository pattern + tests                                  |
| 10  | Errors return a safe message. No stack trace, Prisma object or raw `err.message` reaches the client.                                                               | `errorHandler` + test                                       |
| 11  | Secrets, tokens, OTPs and passwords never appear in logs.                                                                                                          | `pino` redaction list                                       |
| 12  | Passwords are hashed with scrypt. Refresh tokens and OTPs are stored hashed.                                                                                       | `PasswordHasher`, `TokenService`                            |
| 13  | Login, OTP and refresh endpoints have strict rate limits. OTP has an attempt limit and a resend cooldown.                                                          | Redis rate limiters + tests                                 |
| 14  | Auth failures give the same message whether or not the account exists.                                                                                             | Tests                                                       |
| 15  | Uploads have size, count and type limits. Filenames are generated. A file path can never leave the upload folder.                                                  | Upload middleware + tests                                   |
| 16  | List endpoints are paginated with a hard maximum page size.                                                                                                        | Shared pagination schema                                    |
| 17  | CORS uses an allowlist from env. Body size is capped. `helmet` is on.                                                                                              | `app.ts` + tests                                            |
| 18  | No raw SQL built from strings (`$queryRawUnsafe`, `$executeRawUnsafe`).                                                                                            | ESLint `no-restricted-syntax` + `tests/guardrails`          |
| 19  | Schema changes go through Prisma migrations. No `db push`, no `migrate reset`.                                                                                     | Blocked in `.claude/settings.json`                          |
| 20  | The API keeps no state in process memory, so any number of instances can run.                                                                                      | Redis for shared state, review                              |
| 21  | No new package without a reason written in the commit message.                                                                                                     | Review                                                      |
| 22  | No `any`, no floating promises, no `console.log`.                                                                                                                  | ESLint                                                      |
| 23  | A step is done only when `pnpm lint`, `pnpm typecheck` and `pnpm test` all pass.                                                                                   | Definition of done                                          |

## AI rules

These apply from the first AI feature. `src/core/ai` does not exist yet.

| #   | Rule                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Model providers and Qdrant are called only from `src/core/ai`. Modules use the interfaces (`LlmProvider`, `EmbeddingProvider`, `VectorStore`). |
| A2  | Tutor answers use only retrieved book passages and cite them. With no matching passage, the tutor says so instead of answering.                |
| A3  | Every Qdrant search filters by `schoolId` and class. Postgres is the source of truth; Qdrant holds only vectors and the IDs pointing back.     |
| A4  | Student text is untrusted input. It never becomes system instructions, and model output is validated with Zod before it is stored or acted on. |
| A5  | Every model call records user, feature, tokens and cost. Each user has a daily quota.                                                          |
| A6  | Students are minors. Send the model the minimum personal data, never names or phone numbers.                                                   |
| A7  | Prompts live in versioned files under `src/core/ai/prompts`, not inline in services.                                                           |
| A8  | Slow work (book ingestion, embeddings, reports) runs in a job that is safe to run twice, not inside the request.                               |

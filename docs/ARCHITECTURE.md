# Architecture

Buddy is the backend for an AI education platform. It serves a mobile app (students) and an admin panel (staff).
This document explains where code goes and why.

## Stack

| Area            | Choice                                                          |
| --------------- | --------------------------------------------------------------- |
| Runtime         | Node 22, pnpm, TypeScript, ESM (imports end in `.js`)           |
| HTTP            | Express 5, all routes under `/api/v1`                           |
| Database        | PostgreSQL through Prisma 7                                     |
| Cache           | Redis: sessions, OTPs, rate limits, role permissions            |
| Validation      | Zod (requests and env)                                          |
| Tests           | Vitest + supertest against real Postgres and Redis              |
| Vectors (later) | Qdrant, separate from Postgres                                  |
| Jobs (later)    | BullMQ on the same Redis, run by a separate `worker.ts` process |

## Request flow

```
request
  → app.ts            helmet, CORS, body limit, request log, rate limit
  → routes.ts         /api/v1/<module>
  → <module>.routes   guards (verifyAdmin / verifyUser / requirePermission), validate(schema)
  → <module>.controller   reads validated input, calls the service, returns ApiResponse
  → <module>.service      rules, ownership checks, transactions
  → <module>.repository   the only layer that talks to Prisma
  → errorHandler      turns any thrown error into a safe JSON response
```

## Folder map

```
src/
  server.ts            start, graceful shutdown
  app.ts               builds the Express app (middleware order lives here)
  container.ts         the only place classes are constructed and wired together
  routes.ts            mounts every module under /api/v1
  config/              env.ts, prisma.ts, redis.ts, logger.ts, rbac.config.ts
  generated/prisma/    Prisma client output (git-ignored, never edit)
  types/               shared types: JWT payloads, Express request additions
  utils/               ApiError, ApiResponse, asyncHandler, errorHandler,
                       deleteLocalFile, uploadAndCompressImage, pagination
  middlewares/         auth, permission, validate, rate limit, upload, not-found
  core/                shared infrastructure classes
    security/          PasswordHasher, TokenService
    permissions/       PermissionService (Redis cache per role)
    storage/           StorageProvider interface, LocalStorageProvider
    ai/                (later) LlmProvider, EmbeddingProvider, VectorStore, prompts/
    queue/             (later) JobQueue
  jobs/                (later) one processor class per job
  worker.ts            (later) job process
  modules/<feature>/   one folder per feature, always the same five files
prisma/                schema.prisma, migrations, seed.ts
tests/                 guardrails, integration tests per module, security tests
docs/                  RULES.md, ARCHITECTURE.md
```

## The five files of a module

| File                      | Job                                                             | May import                                  |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `<feature>.schema.ts`     | Zod schemas and the types inferred from them                    | `zod`                                       |
| `<feature>.repository.ts` | Class. Database queries with explicit `select`                  | Prisma                                      |
| `<feature>.service.ts`    | Class. Rules, ownership checks, transactions                    | Its own repository, other modules' services |
| `<feature>.controller.ts` | Class. Reads validated input, calls the service, sends response | Its service, `ApiResponse`, `ApiError`      |
| `<feature>.routes.ts`     | Function that builds the router: path, guards, `validate()`     | Controller, middlewares, schema             |

Classes receive what they need through the constructor. `container.ts` creates them in order
(repository → service → controller). There is no DI library.

## Modules

Built now: `admin-auth`, `user-auth`, `session`, `role`, `upload`.

Reserved (create with the `new-module` skill when needed):

| Module             | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `school`           | Schools (the tenant). School-owned tables carry `schoolId`      |
| `classroom`        | Classes and sections inside a school                            |
| `student`          | Student profile, enrolment in a section                         |
| `book`             | Book upload; chunking and embedding run in a job                |
| `assessment`       | Questions, attempts, scores                                     |
| `weakness-profile` | Per-student weak topics, derived from assessments               |
| `learning-path`    | Per-student guide and plan built from the weakness profile      |
| `tutor`            | The strict AI teacher: SSE chat answered only from book content |

## How AI will plug in

Nothing below exists yet. The structure is reserved so no existing code has to move.

- `core/ai/LlmProvider`, `EmbeddingProvider`, `VectorStore` are interfaces. One class per vendor implements them.
  Modules depend on the interface, so the vendor is changed in `container.ts` only.
- Postgres stays the source of truth. Qdrant stores vectors plus `{ schoolId, classId, bookId, chunkId }` so every
  search can be filtered by school and results can be joined back to Postgres rows.
- Book ingestion (extract → chunk → embed → upsert) is a BullMQ job run by `worker.ts`, never inside a request.
- Tutor replies stream over SSE from a normal module route.

## Scale

- The API is stateless. Sessions, rate limits and caches are in Redis, so more instances can be added behind a load balancer.
- The worker is a separate process from the same codebase, scaled on its own.
- Modules talk only through services, so a heavy module can later be moved into its own service.
- Money and counters use single conditional updates (RULES.md #3), which stay correct under concurrent requests.

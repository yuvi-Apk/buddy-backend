---
paths:
  - "src/**"
---

# Architecture

## Request flow

```
request
  → src/app.ts            request log + ID, helmet, CORS allowlist, 100 kb body limit, cookies
  → src/routes.ts         /api/v1, health check, global rate limit, one mount per module
  → <feature>.routes.ts   guard(s) → validate({ body, query, params }) → asyncHandler(controller.x)
  → <feature>.controller  reads req.validated + req.admin / req.user, calls the service
  → <feature>.service     rules, ownership checks, transactions, cache invalidation
  → <feature>.repository  the only layer that talks to Prisma
  → errorHandler          turns any thrown error into a safe JSON response
```

## Folder map

```
src/
  server.ts            start, graceful shutdown
  app.ts               builds the Express app (middleware order lives here)
  container.ts         creates infrastructure, then each module in one line, then the guards
  routes.ts            mounts each module under /api/v1 in one line
  config/              env.ts, prisma.ts, redis.ts, logger.ts, rbac.config.ts, upload.config.ts
  generated/prisma/    Prisma client output (git-ignored, never edit)
  types/               express.d.ts (req additions), jwt.payload.type.ts, module.types.ts
  utils/               ApiError, ApiResponse, asyncHandler, errorHandler, pagination,
                       clientInfo, deleteLocalFile, uploadAndCompressImage
  middlewares/         admin/ and user/ auth guards, routeGuard, validate, rate limit, upload, notFound
  core/                shared infrastructure classes (no business rules)
    security/          GoogleIdTokenVerifier (Google sign-in), TokenService
    permissions/       PermissionService (role pages cached in Redis)
    storage/           StorageProvider (interface + LocalStorageProvider)
    health/            health routes
    ai/                (later) LlmProvider, EmbeddingProvider, VectorStore, prompts/
    queue/             (later) JobQueue
  jobs/                (later) one processor class per job
  worker.ts            (later) job process
  modules/<feature>/   one folder per feature, always six files (see modules.md)
```

Shared types for wiring live in `src/types/module.types.ts`: `Infra` (prisma, redis, logger),
`Guards` and `RouterDeps` (guards + rate limiters).

## Modules

Built: `admin-auth`, `user-auth`, `session`, `role`, `upload`.

Reserved (create with the `new-module` skill when needed):

| Module             | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `organization`     | Schools, colleges, coaching centres (the tenant); memberships   |
| `classroom`        | Classes and sections inside a school                            |
| `student`          | Student profile, enrolment in a section                         |
| `book`             | Book upload; chunking and embedding run in a job                |
| `assessment`       | Questions, attempts, scores                                     |
| `weakness-profile` | Per-student weak topics, derived from assessments               |
| `learning-path`    | Per-student guide and plan built from the weakness profile      |
| `tutor`            | The strict AI teacher: SSE chat answered only from book content |

## Scale

- The API is stateless: sessions, rate limits and caches are in Redis, so more instances can run behind a load balancer.
- The worker (later) is a separate process from the same codebase, scaled on its own.
- Modules talk only through services exported from `index.ts`, so a heavy module can later move into its own service.
- Money and counters use single conditional updates (core-rules #3), which stay correct under concurrent requests.

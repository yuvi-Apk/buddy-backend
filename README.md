# Buddy backend

The API behind Buddy, an AI education platform. It serves two clients:

- the **mobile app** for students, who log in with their phone number and a one-time code
- the **admin panel** for staff, who log in with email and password and see only the pages their role allows

Today it holds the foundation: authentication, sessions, roles and permissions, uploads, and the
guardrails every future feature (schools, classes, books, the AI tutor) will be built on.

| Area       | Choice                                                 |
| ---------- | ------------------------------------------------------ |
| Runtime    | Node 22, pnpm, TypeScript (ESM: imports end in `.js`)  |
| HTTP       | Express 5, every route under `/api/v1`                 |
| Database   | PostgreSQL through Prisma 7                            |
| Cache      | Redis: sessions, login codes, rate limits, permissions |
| Validation | Zod, for every request and for the environment         |
| Tests      | Vitest + supertest against real Postgres and Redis     |

## Setup

You need Node 22+, pnpm and Docker Desktop.

```bash
pnpm install                    # also generates the Prisma client
docker compose up -d            # Postgres on 5432 (databases buddy + buddy_test), Redis on 6379
cp .env.sample .env             # then fill in the values, see below
pnpm exec prisma migrate dev    # create the tables
pnpm db:seed                    # create the SUPER_ADMIN role and the first admin
pnpm dev                        # http://localhost:4000/api/v1/health/ready
```

In `.env`, set three **different** random secrets of at least 32 characters
(`ADMIN_ACCESS_TOKEN_SECRET`, `USER_ACCESS_TOKEN_SECRET`, `OTP_HMAC_SECRET`):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Also set `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` (12+ characters) for the first admin.
The app refuses to start when a variable is missing or invalid, and names the variable.

Ports 5432 and 6379 are databases, not websites, so a browser can't open them. To look at the data,
run `pnpm exec prisma studio` (opens on port 5555) or use a database client.

## Commands

| Command                                        | What it does                                     |
| ---------------------------------------------- | ------------------------------------------------ |
| `pnpm dev`                                     | Start the API and reload on change               |
| `pnpm build` / `pnpm start`                    | Compile to `dist/` / run the compiled API        |
| `pnpm lint`                                    | ESLint, including the architecture rules         |
| `pnpm typecheck`                               | TypeScript check                                 |
| `pnpm test`                                    | All tests (needs `docker compose up -d`)         |
| `pnpm test tests/modules/role.test.ts`         | One test file                                    |
| `pnpm format`                                  | Prettier                                         |
| `pnpm exec prisma migrate dev --name <change>` | New database migration                           |
| `pnpm db:seed`                                 | Create the first super admin (safe to run again) |

## API

All routes are under `/api/v1`.

| Area           | Routes                                                                                 | Who may call it                    |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| Health         | `GET /health`, `GET /health/ready`                                                     | anyone                             |
| Admin auth     | `POST /admin/auth/login`, `POST /admin/auth/refresh`                                   | anyone (rate limited)              |
|                | `POST /admin/auth/logout`, `GET /admin/auth/me`                                        | logged-in admin                    |
| Admin sessions | `GET /admin/sessions`, `DELETE /admin/sessions/:id`                                    | logged-in admin, own sessions only |
| Roles          | `GET POST /admin/roles`, `GET PATCH DELETE /admin/roles/:id`, `GET /admin/roles/pages` | admin with the `ROLE` page         |
| Uploads        | `POST /admin/uploads/images`, `GET /admin/uploads`, `DELETE /admin/uploads/:id`        | admin with the `UPLOAD` page       |
| User auth      | `POST /user/auth/otp/request`, `POST /user/auth/otp/verify`, `POST /user/auth/refresh` | anyone (rate limited)              |
|                | `POST /user/auth/logout`, `GET /user/auth/me`                                          | logged-in user                     |
| User sessions  | `GET /user/sessions`, `DELETE /user/sessions/:id`                                      | logged-in user, own sessions only  |

Responses always have the same shape:

```jsonc
// success
{ "statusCode": 200, "data": { ... }, "message": "Roles fetched", "success": true }
// error
{ "success": false, "message": "Validation failed", "errors": [{ "field": "name", "message": "..." }], "data": null }
```

## Guides

Start with the overview, then read the guide for what you are about to do.

| Guide                                                      | Read it when you want to                                  |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| [01 Overview](docs/01-overview.md)                         | understand how a request travels through the code         |
| [02 Module anatomy](docs/02-module-anatomy.md)             | know what each of a module's six files does               |
| [03 Create a module](docs/03-create-a-module.md)           | add a new feature (school, student, book, ...)            |
| [04 Add an endpoint](docs/04-add-an-endpoint.md)           | add a route to a module that already exists               |
| [05 Auth and permissions](docs/05-auth-and-permissions.md) | protect a route, add an admin page, understand sessions   |
| [06 Database](docs/06-database.md)                         | write queries, change the schema, update a counter safely |
| [07 Testing](docs/07-testing.md)                           | write or run tests                                        |
| [08 Workflow](docs/08-workflow.md)                         | add an env variable, upload files, hand over a change     |

## Working with Claude Code

This repo is set up for Claude Code. `CLAUDE.md` is the short brief, `.claude/rules/` holds the rules
(loaded only for the files being edited), and two skills, `new-module` and `add-endpoint`, walk
through the same steps as guides 03 and 04. A hook stops Claude from reading `.env`, and Claude never
commits: it hands over a commit message for you to review.

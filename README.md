# Buddy backend

Backend for the Buddy AI education platform: a mobile app for students and an admin panel for staff.
Node 22, pnpm, TypeScript, Express 5, Prisma 7 + PostgreSQL, Redis, Zod, Vitest.

## Setup

```bash
pnpm install                    # also generates the Prisma client
docker compose up -d            # Postgres (5432, databases buddy + buddy_test) and Redis (6379)
cp .env.sample .env             # then fill in the values (see below)
pnpm exec prisma migrate dev    # create the tables
pnpm db:seed                    # create the SUPER_ADMIN role and the first super admin
pnpm dev                        # http://localhost:4000/api/v1/health/ready
```

`.env` needs three different random secrets of at least 32 characters:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The app refuses to start if any variable is missing or invalid, and names the variable.

## Commands

| Command          | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Start the API with reload                            |
| `pnpm build`     | Generate the Prisma client and compile to `dist/`    |
| `pnpm start`     | Run the compiled API                                 |
| `pnpm lint`      | ESLint, including the architecture rules             |
| `pnpm typecheck` | TypeScript check                                     |
| `pnpm test`      | Vitest against `buddy_test` (needs `docker compose`) |
| `pnpm format`    | Prettier                                             |
| `pnpm db:seed`   | Create the first super admin                         |

## API (all under `/api/v1`)

| Area           | Routes                                                                                   | Guard                         |
| -------------- | ---------------------------------------------------------------------------------------- | ----------------------------- |
| Health         | `GET /health`, `GET /health/ready`                                                       | public                        |
| Admin auth     | `POST /admin/auth/login`, `/refresh`, `/logout`, `GET /admin/auth/me`                    | public (rate limited) / admin |
| Admin sessions | `GET /admin/sessions`, `DELETE /admin/sessions/:id`                                      | admin, own sessions only      |
| Roles          | `GET POST /admin/roles`, `GET PATCH DELETE /admin/roles/:id`, `GET /admin/roles/pages`   | admin + `ROLE` page           |
| Uploads        | `POST /admin/uploads/images`, `GET /admin/uploads`, `DELETE /admin/uploads/:id`          | admin + `UPLOAD` page         |
| User auth      | `POST /user/auth/otp/request`, `/otp/verify`, `/refresh`, `/logout`, `GET /user/auth/me` | public (rate limited) / user  |
| User sessions  | `GET /user/sessions`, `DELETE /user/sessions/:id`                                        | user, own sessions only       |

Every response has the shape `{ success, message, errors, data }` (errors) or
`{ statusCode, data, message, success }` (success).

## Docs

- [CLAUDE.md](CLAUDE.md): working rules, don'ts and definition of done
- [docs/RULES.md](docs/RULES.md): every rule and how it is enforced
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): folder structure, request flow, how AI features will plug in
- `.claude/skills/new-module` and `.claude/skills/add-endpoint`: step-by-step guides for new features

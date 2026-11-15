# Buddy backend

Backend for the Buddy AI education platform. Node 22, Express 5, Prisma + PostgreSQL, Redis.

## Setup

```bash
pnpm install
docker compose up -d            # Postgres (5432) and Redis (6379)
cp .env.sample .env             # then fill in the values
pnpm exec prisma migrate dev    # create the tables
pnpm db:seed                    # create the first super admin
pnpm dev
```

## Commands

| Command          | What it does                             |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Start the API with reload                |
| `pnpm build`     | Compile to `dist/`                       |
| `pnpm start`     | Run the compiled API                     |
| `pnpm lint`      | ESLint, including the architecture rules |
| `pnpm typecheck` | TypeScript check                         |
| `pnpm test`      | Vitest (needs `docker compose up -d`)    |
| `pnpm format`    | Prettier                                 |

## Docs

- [docs/RULES.md](docs/RULES.md): the rules and how each one is enforced
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): folder structure and where code goes
- [CLAUDE.md](CLAUDE.md): working rules for Claude Code and for developers

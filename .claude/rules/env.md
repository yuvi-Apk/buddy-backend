---
paths:
  - "src/config/env.ts"
  - ".env.sample"
  - ".env.test"
  - "prisma.config.ts"
---

# Env files

- Never read or edit `.env`. It holds the user's real secrets and is blocked in `.claude/settings.json`
  and by the `protect-env` hook.
- `.env.sample` (committed, no real values) and `.env.test` (committed, local test values) may be read and edited.
- Code reads env only through `env` from `src/config/env.ts` (core-rules #2).

## Adding a variable

1. Add it to the Zod schema in `src/config/env.ts`, with a clear type and limits.
2. Add it to `.env.sample` (with a placeholder and a comment) and to `.env.test` (with a test value).
3. Tell the user the variable name and what to put in it, so they can add the real value to `.env`.

`tests/guardrails/env-sample.test.ts` fails if `.env.sample` or `.env.test` and the schema list different keys.

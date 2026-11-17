# 08 Workflow

Day-to-day tasks that don't fit in one module, and what to do before you hand over a change.

## Settings and the env files

| File          | Committed | Holds                                           |
| ------------- | --------- | ----------------------------------------------- |
| `.env`        | no        | Your real values and secrets. Only you edit it. |
| `.env.sample` | yes       | Every variable with a placeholder and a comment |
| `.env.test`   | yes       | Local, non-secret values the tests run with     |

Code never reads `process.env`; it imports `env` from `src/config/env.ts`, where every variable is
checked by a Zod schema when the app starts. A missing or invalid value stops the app with the
variable's name (never its value).

**To add a variable:**

1. Add it to the schema in `src/config/env.ts`, with a type and limits:

   ```ts
   SMS_API_KEY: z.string().min(20),
   ```

2. Add it to `.env.sample` (placeholder and a comment saying what it is) and to `.env.test`.
3. Add the real value to your `.env`, and tell the team, so everyone updates theirs.

`tests/guardrails/env-sample.test.ts` fails if step 2 is forgotten, so `.env.sample` can't go stale.

## Uploads and storage

Admins upload images through `POST /admin/uploads/images` (field `image`, optional `folder`).

1. `uploadSingleImage("image")` (multer) accepts one file up to 5 MB, only JPEG, PNG or WebP, and
   saves it to `tmp/uploads` under a random name.
2. `uploadAndCompressImage` checks the file really is an image, converts it to WebP, shrinks it to
   about 100 KB, saves it through the `StorageProvider`, and always deletes the temp file.
3. A row in `UploadedFile` records the URL, so files can be listed and deleted by ID.

Allowed folders are listed in `UPLOAD_FOLDERS` in `src/config/upload.config.ts`. Files are served
from `/images/...` with local storage. `deleteLocalFile` only deletes inside the upload folders, so
a crafted path like `../../.env` deletes nothing.

To move to S3 or Cloudinary later: write a class that implements `StorageProvider`
(`src/core/storage/StorageProvider.ts`), add a value to `STORAGE_DRIVER` in `env.ts`, and choose
the class in `src/container.ts`. No module changes.

## Errors and responses

- Expected failure: `throw ApiError.notFound("School not found")`. Also `badRequest`, `unauthorized`,
  `forbidden`, `conflict`, `tooManyRequests`, or `new ApiError(status, message)`.
- Success: `res.status(200).json(new ApiResponse(200, data, "Schools fetched"))`.
- Anything else that is thrown becomes a 500 "Internal Server Error". The real error is logged with
  the request ID, never sent to the client.
- Never log passwords or tokens. The logger hides fields named `password`, `token`,
  `accessToken`, `refreshToken`, `idToken`, and the `Authorization` and `Cookie` headers, but don't
  rely on that for new names.

## Adding a package

Add one only if nothing in Node or the current dependencies can do the job, and write the reason in
the commit message. Node already gives you `crypto.randomUUID`, `crypto.createPublicKey`, `fetch`, `--env-file`
and `fs/promises`.

## Before you hand over a change

```bash
pnpm lint && pnpm typecheck && pnpm test
```

A change is done when:

1. All three commands pass.
2. New behaviour has tests, including 401, 403, 400, 404 and "not the owner".
3. Every new route has a guard and a `validate()` schema.
4. New env variables are in the schema, `.env.sample` and `.env.test`.
5. No rule in `.claude/rules/core-rules.md` is broken.

Then commit with a message that says what changed and why. When Claude Code made the change, it
stops and gives you the message; you review the diff and commit.

## Common mistakes and the error you'll see

| You did                                                                | You'll see                                                                     | Fix                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Imported Prisma in a controller or service                             | `pnpm lint`: "Only *.repository.ts files may use Prisma (core-rules #5)"       | Move the query into the repository                                             |
| Imported `../../shared/session/session.service.js` from another module | `pnpm lint`: "Import another module only through its index.js (core-rules #6)" | Import from `../../shared/session/index.js` (export the type there if needed)  |
| Added a route without a guard                                          | `route-guards.test.ts` fails and names the route                               | Add `verifyAdmin` + `requirePermission(...)`, `verifyUser`, or `publicRoute()` |
| Read `req.body` in a controller                                        | Undefined or unchecked input; review rejects it                                | Add `validate({ body })` and read `req.validated.body`                         |
| Used `process.env.X`                                                   | `pnpm lint`: "Read env only through `env`"                                     | Add `X` to `env.ts` and import `env`                                           |
| Added an env variable only to `.env`                                   | `env-sample.test.ts` fails                                                     | Add it to `.env.sample` and `.env.test`                                        |
| Added a table but not to `TRUNCATE`                                    | Tests pass alone but fail together (leftover rows)                             | Add it to `resetState` in `tests/helpers/testApp.ts`                           |
| Put `/pages` below `/:id`                                              | `GET /pages` answers 400, because "pages" is read as an ID                     | Move fixed paths above `/:id`                                                  |
| Wrote a controller method as a normal method                           | `Cannot read properties of undefined (reading 'roleService')`                  | Use an arrow property: `list = async (req, res) => {}`                         |
| Forgot `asyncHandler` on an async route                                | The request hangs or the process logs an unhandled rejection                   | Wrap it: `asyncHandler(controller.list)`                                       |
| Forgot `.js` in an import                                              | `ERR_MODULE_NOT_FOUND` at start-up                                             | Write `./role.service.js`                                                      |
| Ran `prisma migrate dev` but tests use old tables                      | Tests fail on a missing column                                                 | Run `pnpm test` again; global setup applies migrations to `buddy_test`         |

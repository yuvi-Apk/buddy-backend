# 05 Auth and permissions

There are two kinds of caller, and their tokens can never be swapped:

| Caller               | Logs in with          | Guard         | Sets on `req`               |
| -------------------- | --------------------- | ------------- | --------------------------- |
| Staff (admin panel)  | Email + password      | `verifyAdmin` | `req.adminUser`, `req.auth` |
| Student (mobile app) | Phone + one-time code | `verifyUser`  | `req.user`, `req.auth`      |

Admin and user tokens are signed with different secrets and audiences, so a user token on an admin
route always gets 401, and the other way round.

## Choosing a guard

Every route must have one of these. `tests/guardrails/route-guards.test.ts` fails if a route has none.

| The route is for                                  | Guards                                       |
| ------------------------------------------------- | -------------------------------------------- |
| An admin panel page (roles, uploads, schools ...) | `verifyAdmin`, `requirePermission("<PAGE>")` |
| Something any of several admin pages may use      | `verifyAdmin`, `requireAnyPermission([...])` |
| The admin's own account (profile, own sessions)   | `verifyAdmin`, `ownAccountRoute()`           |
| The mobile app                                    | `verifyUser`                                 |
| Open on purpose (login, request a code)           | `publicRoute()`, plus `authRateLimit`        |

`ownAccountRoute()` and `publicRoute()` don't check anything themselves. They are labels that say
"this is deliberate", so the guard test can tell a forgotten guard from an intentional one.

## Admin pages and roles

Permissions are defined **in code**, in `src/config/rbac.config.ts`:

```ts
export const PAGES = ["ROLE", "UPLOAD"] as const;
export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";
```

- A **page** is one area of the admin panel.
- A **role** (stored in the `Role` table) is granted pages one by one (`RolePermission` rows with
  `isAccess = true`). Super admins manage roles through `/admin/roles`.
- Admins with the `SUPER_ADMIN` role pass every permission check. That role can't be edited or
  deleted, and no admin can edit their own role.
- `GET /admin/auth/me` returns the admin's `pages`, so the admin panel can hide what they can't open.

To protect a new admin feature: add its page to `PAGES`, then use `requirePermission("<PAGE>")` on its
routes. `requirePermission` reads the role's pages from Redis (`role-perms:<roleId>`, filled from
Postgres on a miss). When a role changes, `RoleService` clears that key, so the change applies on
the admin's very next request.

## Sessions and tokens

Each login creates a row in the `Session` table and returns two tokens:

| Token         | Lifetime                        | Where it travels                                                                     |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| Access token  | `ACCESS_TOKEN_TTL_MINUTES` (15) | Admin: `accessToken` cookie or `Authorization: Bearer`. App: `Authorization: Bearer` |
| Refresh token | `REFRESH_TOKEN_TTL_DAYS` (30)   | Admin: `refreshToken` cookie, sent only to `/api/v1/admin/auth`. App: response body  |

- Cookies are `httpOnly` and `SameSite=Strict`, and `Secure` in production. The admin refresh token
  never appears in a response body.
- Only a SHA-256 hash of the refresh token is stored.
- **Rotation:** every refresh returns a new refresh token, and the old one stops working. If an old
  one is used again (a sign it was stolen), the whole session is revoked.
- **Logout works at once:** `verifyAdmin` and `verifyUser` check on every request that the session
  is still active (Redis `session:<id>`, Postgres if Redis doesn't have it). Logging out marks the
  session revoked, so the same access token gets 401 on the next request, even though it hasn't
  expired.
- Admins and users can list their sessions and revoke one (`/admin/sessions`, `/user/sessions`).
  Revoking someone else's session answers 404.

## Admin login protection

- The same message, "Invalid email or password", for a wrong password, an unknown email and a
  disabled account, and the same response time (a decoy hash is checked for unknown emails).
- After 5 wrong passwords the account is locked for 15 minutes.
- Login and refresh are limited to 20 requests per 15 minutes per IP.

## User login with a one-time code (OTP)

1. `POST /user/auth/otp/request { phone }` creates a 6-digit code and sends it through the
   `OtpSender`. The answer is the same whether the number is known or not.
2. `POST /user/auth/otp/verify { phone, otp }` checks it. The account is created on the first
   successful login.

Limits: the code lives 5 minutes and works once; 5 wrong guesses destroy it; one code per minute and
5 per hour per phone. Only an HMAC of the code is stored, in Redis.

Phone numbers must be in international format: `+` and 8–15 digits, for example `+919812345678`.

`OTP_SENDER=log` prints the code in the server log, for development. The app refuses to start with
it in production. A real SMS provider is added as a new class implementing `OtpSender`
(`src/core/otp/OtpSender.ts`) and chosen in `src/container.ts`.

## Using the caller in your code

```ts
// controller, on an admin route
const admin = req.adminUser!; // { id, name, email, role: { id, name } }

// controller, on an app route
const user = req.user!; // { id, phone, name }
```

Pass the caller to the service and check ownership there, for example "this student belongs to
the admin's school". Never trust an ID from the body to say who the caller is.

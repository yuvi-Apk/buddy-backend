# 05 Auth and permissions

There are two kinds of caller, and their tokens can never be swapped:

| Caller                             | Signs in with | Devices       | Guard         | Sets on `req`           |
| ---------------------------------- | ------------- | ------------- | ------------- | ----------------------- |
| Staff (super admin panel)          | Google        | one at a time | `verifyAdmin` | `req.admin`, `req.auth` |
| App user (individual, student ...) | Google        | many          | `verifyUser`  | `req.user`, `req.auth`  |

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
| The app, inside one organization                  | `verifyUser`, `requireOrganizationRole(...)` |
| Open on purpose (sign-in, refresh)                | `publicRoute()`, plus `authRateLimit`        |

`ownAccountRoute()` and `publicRoute()` don't check anything themselves. They are labels that say
"this is deliberate", so the guard test can tell a forgotten guard from an intentional one.

## Admin pages and roles

Permissions are defined **in code**, in `src/config/rbac.config.ts`:

```ts
export const PAGES = ["ROLE", "UPLOAD", "ORGANIZATION"] as const;
export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";
```

- A **page** is one area of the admin panel.
- A **role** (table `admin_roles`) is granted pages one by one (`admin_permissions` rows with
  `canAccess = true`). Super admins manage roles through `/admin/roles`.
- Admins with the `SUPER_ADMIN` role pass every permission check. That role can't be edited or
  deleted, and no admin can edit their own role.
- `GET /admin/auth/me` returns the admin's `pages`, so the admin panel can hide what they can't open.

To protect a new admin feature: add its page to `PAGES`, then use `requirePermission("<PAGE>")` on its
routes. `requirePermission` reads the role's pages from Redis (`role-perms:<roleId>`, filled from
Postgres on a miss). When a role changes, `RoleService` clears that key, so the change applies on
the admin's very next request.

## Organizations (inside the app)

A user's rights inside a school, college or coaching centre come from their **membership**
(`memberships.role`: `STUDENT`, `TEACHER` or `ORGANIZATION_ADMIN`), not from the user row. A user
with no active membership is an individual.

App routes that act inside one organization add `requireOrganizationRole(...)` after `verifyUser`,
and the app names the organization in a header:

```ts
router.get("/current", verifyUser, requireOrganizationRole(), controller.getCurrent);
router.patch("/current/join-code", verifyUser, requireOrganizationRole("ORGANIZATION_ADMIN"), ...);
```

```
X-Organization-Id: <organization id>      (from GET /user/organizations)
```

| Situation                                                       | Answer |
| --------------------------------------------------------------- | ------ |
| Header missing or not a UUID                                    | 400    |
| Not a member, left, removed, or the organization is deactivated | 404    |
| Membership suspended, or the role is not in the list            | 403    |

No roles means any active member. The guard sets `req.membership` (`id`, `organizationId`, `role`);
services scope every query by `req.membership.organizationId`, never by an id from the body.

**Joining** (an admin adds an organization admin today; invites and join codes come next) always goes
through `OrganizationService.addMember`, one transaction with two conditional updates
(core-rules #3):

1. `users.activeMembershipCount` goes up only if it is 0, or the user has
   `canJoinMultipleOrganizations` (set by an admin: `PATCH /admin/users/:userId/membership-settings`).
2. `organizations.activeMemberCount` goes up only if the organization is active and below `maxMembers`.
3. The membership is created, or a `LEFT` / `REMOVED` one is reactivated.

Any refusal rolls all three back and answers 409. CHECK constraints in the database back up both limits.

## Sessions and tokens

Each sign-in creates a row in the `sessions` table and returns two tokens:

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
  Revoking someone else's session answers 404. Each session shows `deviceUserAgent` and `deviceIp`
  so people can tell their devices apart.

## Google sign-in

Both panels sign in with Google only. The client gets an **ID token** from "Sign in with Google"
and sends it to the API:

| Panel | Route                                 | Account                                          |
| ----- | ------------------------------------- | ------------------------------------------------ |
| Admin | `POST /admin/auth/google { idToken }` | Must already exist (seed or another admin)       |
| App   | `POST /user/auth/google { idToken }`  | Created on first sign-in from the Google profile |

`GoogleIdTokenVerifier` (`src/core/security/`) checks the token's RS256 signature against Google's
public keys, the issuer, the audience (one of `GOOGLE_CLIENT_IDS`), the expiry, and that the email
is verified. Google's keys are cached in Redis (`google:jwks`) for as long as Google says; an
unknown key id refetches at most once a minute.

- **Admins:** the first sign-in links the Google account (`googleAccountId`) to the admin with that
  email. After that the admin is found by Google account, even if the Google email changes. An
  email already linked to another Google account is refused.
- **One device at a time (admins):** a sign-in revokes every other session of that admin in the
  same transaction, under a Postgres advisory lock, so parallel sign-ins can't leave two alive.
- **Many devices (users):** each sign-in adds a session. `POST /user/auth/logout` ends this device;
  `POST /user/auth/logout-all` ends every device of the user.
- Every failure (bad token, unknown or disabled account, another Google account) answers 401
  "Google sign-in failed" (core-rules #14).
- Sign-in and refresh are limited to 20 requests per 15 minutes per IP.

`GOOGLE_CLIENT_IDS` lists the OAuth client IDs whose tokens are accepted: the admin panel's web
client and the app's Android and iOS clients, comma-separated.

## Using the caller in your code

```ts
// controller, on an admin route
const admin = req.admin!; // { id, name, email, avatarUrl, role: { id, name } }

// controller, on an app route
const user = req.user!; // { id, email, name, avatarUrl, examCategory }
```

Pass the caller to the service and check ownership there, for example "this student belongs to
the caller's organization". Never trust an ID from the body to say who the caller is.

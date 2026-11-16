---
paths:
  - "src/**"
  - "tests/**"
  - "prisma/**"
---

# Naming (core-rules #24)

A reader should know what a name holds or does without opening another file. When a name needs
a comment to explain it, rename it instead.

## Code: variables, functions, classes

- **Say what it is, with the unit or kind when it matters.** `refreshTokenHash`, `expiresAt`,
  `sizeBytes`, `accessTokenTtlMinutes`, `organizationId`. Not `data`, `obj`, `tmp`, `val`, `res2`, `x`.
- **Booleans read as a yes/no question**: `isActive`, `hasAccess`, `canJoinMultipleOrganizations`,
  `isJoinCodeEnabled`, `canAccess`. Not `active`, `flag`, `status` (for a boolean).
- **Functions start with a verb and say the result or the effect**:
  `findActiveMemberByUserId`, `revokeOtherSessionsOfAdmin`, `countPendingJoinRequests`,
  `sendInviteEmail`. Not `handle`, `process`, `doIt`, `check`, `getData`.
  - `find…` may return null, `get…` throws when missing, `list…` returns a page, `count…` a number,
    `is…` / `has…` / `can…` a boolean, `create…` / `update…` / `delete…` / `revoke…` change data.
  - A method that returns a secret says so: `findWithRefreshTokenHash` (core-rules #9).
- **Ids name their target**: `adminId`, `classroomId`, `membershipId`, `reviewedByUserId`. Never a bare `id`
  when there are two kinds of id in scope.
- **Collections are plural**: `members`, `pageNames`. A map says both sides: `roleIdToPageNames`.
- **No abbreviations** except well-known ones (`id`, `url`, `ip`, `dto`, `jwt`, `otp`).
  `organization`, not `org`; `request`, not `req` (except Express's `req` / `res`).
- **Same thing, same name everywhere**: if the column is `inviteeEmail`, the Zod field, the DTO
  field and the variable are `inviteeEmail` too.
- Files and folders: kebab-case, singular (`join-request`). Classes: PascalCase
  (`JoinRequestService`). Constants: UPPER_SNAKE_CASE (`MAX_PAGE_SIZE`).

## Database: models, fields, tables, columns

- **Short and plain.** A model is the shortest singular noun that is clear on its own:
  `User`, `Session`, `Organization`, `Membership`, `Classroom`, `Invite`, `JoinRequest`, `Upload`.
  Not `OrganizationInvite` or `LoginSession`: the extra word adds length, not meaning.
- **Prefix only when the word alone is ambiguous.** `Admin*` means super admin panel staff
  (`Admin`, `AdminRole`, `AdminPermission`), because "admin" also exists inside an organization
  (`MembershipRole.ORGANIZATION_ADMIN`).
- **Only tables are mapped.** Table = plural snake_case of the model, with `@@map`. Columns keep
  the field name (camelCase) and enums keep their own name: no `@map` on fields, no `@@map` on enums.

  | Model             | Table               |
  | ----------------- | ------------------- |
  | `Admin`           | `admins`            |
  | `AdminRole`       | `admin_roles`       |
  | `AdminPermission` | `admin_permissions` |
  | `User`            | `users`             |
  | `Session`         | `sessions`          |
  | `Organization`    | `organizations`     |
  | `Membership`      | `memberships`       |
  | `Classroom`       | `classrooms`        |
  | `ClassroomMember` | `classroom_members` |
  | `Invite`          | `invites`           |
  | `JoinRequest`     | `join_requests`     |
  | `Upload`          | `uploads`           |

  ```prisma
  model JoinRequest {
    requestedRole MembershipRole // column "requestedRole", enum type "MembershipRole"
    @@map("join_requests")
  }
  ```

  Every model has `@@map`. A new model is added to this table.

- **Foreign keys are `<relation>Id`**, and when there are two links to the same table, say the role:
  `sentByUserId`, `acceptedByUserId`, `reviewedByUserId`, `createdByAdminId`.
- **Counters say what they count**: `activeMemberCount`, not `count` or `members`.
- **Timestamps end in `At`** (`revokedAt`), and **booleans start with `is` / `can` / `has`**.
- **Enum names start with their model** (`MembershipStatus`, `InviteStatus`), so `Status` never stands alone.

## Comments

A good name needs no comment. Write one only for what the code can't say: a reason, a rule, a unit.

- **Only `//`.** No `///`, `/** */` or `/* */`, in code, tests or the schema.
- **Short and sweet.** One line when possible; fragments are fine: `// lowercase`, `// null = unlimited`.
  No filler ("This field is used to…"), and don't restate the name.
- **Where:** above a model, function or class when its job isn't obvious; at the end of a line for
  a 1–3 word note; inside a function only for _why_, never _what_. Rule references: `// core-rules #3`.
- **Major sections** (schema, long files) get an `====` banner:

  ```
  // ===========================================================================
  // Super admin panel
  // ===========================================================================
  ```

- No commented-out code, no TODO without an owner or issue.

## Tests

`it("returns 404 when the invite belongs to another organization")`, not `it("works")`.
Fixture variables say who they are: `organizationAdmin`, `studentOfOtherOrganization`.

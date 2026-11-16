-- Google sign-in, short table names, organizations.
-- Hand-edited: roles, permissions, admins and uploads are renamed in place so their rows are
-- kept. "User" and "Session" are dropped: phone users can't move to Google sign-in, and every
-- session ends anyway.

-- ===========================================================================
-- Enums
-- ===========================================================================

CREATE TYPE "ExamCategory" AS ENUM ('GOVERNMENT_EXAM', 'SCHOOL', 'COLLEGE', 'OTHER');
CREATE TYPE "SessionOwnerType" AS ENUM ('ADMIN', 'USER');
CREATE TYPE "OrganizationType" AS ENUM ('SCHOOL', 'COLLEGE', 'COACHING', 'OTHER');
CREATE TYPE "OrganizationPlan" AS ENUM ('BASIC');
CREATE TYPE "MembershipRole" AS ENUM ('STUDENT', 'TEACHER', 'ORGANIZATION_ADMIN');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LEFT', 'REMOVED');
CREATE TYPE "JoinMethod" AS ENUM ('ADDED_BY_ADMIN', 'ACCEPTED_INVITE', 'APPROVED_JOIN_REQUEST');
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- ===========================================================================
-- Dropped: phone users and their sessions
-- ===========================================================================

DROP TABLE "Session";
DROP TABLE "User";
DROP TYPE "SessionSubject";

-- ===========================================================================
-- Renamed in place (rows kept)
-- ===========================================================================

-- Role -> admin_roles
ALTER TABLE "Role" RENAME TO "admin_roles";
ALTER TABLE "admin_roles" RENAME CONSTRAINT "Role_pkey" TO "admin_roles_pkey";
ALTER INDEX "Role_name_key" RENAME TO "admin_roles_name_key";

-- RolePermission -> admin_permissions
ALTER TABLE "RolePermission" RENAME TO "admin_permissions";
ALTER TABLE "admin_permissions" RENAME COLUMN "page" TO "pageName";
ALTER TABLE "admin_permissions" RENAME COLUMN "isAccess" TO "canAccess";
ALTER TABLE "admin_permissions" RENAME CONSTRAINT "RolePermission_pkey" TO "admin_permissions_pkey";
ALTER TABLE "admin_permissions" RENAME CONSTRAINT "RolePermission_roleId_fkey" TO "admin_permissions_roleId_fkey";

-- AdminUser -> admins: passwords and lockout go, Google sign-in comes in
ALTER TABLE "AdminUser" RENAME TO "admins";
ALTER TABLE "admins" DROP COLUMN "passwordHash";
ALTER TABLE "admins" DROP COLUMN "failedLoginCount";
ALTER TABLE "admins" DROP COLUMN "lockedUntil";
ALTER TABLE "admins" ADD COLUMN "googleAccountId" TEXT;
ALTER TABLE "admins" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "admins" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "admins" RENAME CONSTRAINT "AdminUser_pkey" TO "admins_pkey";
ALTER TABLE "admins" RENAME CONSTRAINT "AdminUser_roleId_fkey" TO "admins_roleId_fkey";
ALTER INDEX "AdminUser_email_key" RENAME TO "admins_email_key";
ALTER INDEX "AdminUser_roleId_idx" RENAME TO "admins_roleId_idx";
CREATE UNIQUE INDEX "admins_googleAccountId_key" ON "admins"("googleAccountId");

-- UploadedFile -> uploads
ALTER TABLE "UploadedFile" RENAME TO "uploads";
ALTER TABLE "uploads" RENAME CONSTRAINT "UploadedFile_pkey" TO "uploads_pkey";
ALTER TABLE "uploads" RENAME CONSTRAINT "UploadedFile_uploadedByAdminId_fkey" TO "uploads_uploadedByAdminId_fkey";
ALTER INDEX "UploadedFile_url_key" RENAME TO "uploads_url_key";
ALTER INDEX "UploadedFile_folder_createdAt_idx" RENAME TO "uploads_folder_createdAt_idx";
ALTER INDEX "UploadedFile_uploadedByAdminId_idx" RENAME TO "uploads_uploadedByAdminId_idx";

-- ===========================================================================
-- New tables
-- ===========================================================================

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "examCategory" "ExamCategory",
    "canJoinMultipleOrganizations" BOOLEAN NOT NULL DEFAULT false,
    "activeMembershipCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "ownerType" "SessionOwnerType" NOT NULL,
    "adminId" TEXT,
    "userId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "previousRefreshTokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceUserAgent" TEXT,
    "deviceIp" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL DEFAULT 'SCHOOL',
    "slug" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "isJoinCodeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "plan" "OrganizationPlan" NOT NULL DEFAULT 'BASIC',
    "maxMembers" INTEGER,
    "activeMemberCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinMethod" "JoinMethod" NOT NULL,
    "sharePastDataWithOrganization" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYear" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classroom_members" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classroom_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "classroomId" TEXT,
    "inviteeEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "roleOnJoin" "MembershipRole" NOT NULL DEFAULT 'STUDENT',
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentByUserId" TEXT,
    "sentByAdminId" TEXT,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "join_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedRole" "MembershipRole" NOT NULL DEFAULT 'STUDENT',
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "sharePastDataWithOrganization" BOOLEAN NOT NULL DEFAULT false,
    "requesterNote" TEXT,
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- Indexes
-- ===========================================================================

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_googleAccountId_key" ON "users"("googleAccountId");
CREATE INDEX "sessions_adminId_revokedAt_idx" ON "sessions"("adminId", "revokedAt");
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "organizations_joinCode_key" ON "organizations"("joinCode");
CREATE INDEX "memberships_userId_status_idx" ON "memberships"("userId", "status");
CREATE INDEX "memberships_organizationId_status_role_idx" ON "memberships"("organizationId", "status", "role");
CREATE UNIQUE INDEX "memberships_organizationId_userId_key" ON "memberships"("organizationId", "userId");
CREATE UNIQUE INDEX "memberships_id_organizationId_key" ON "memberships"("id", "organizationId");
CREATE INDEX "classrooms_organizationId_isArchived_idx" ON "classrooms"("organizationId", "isArchived");
CREATE UNIQUE INDEX "classrooms_organizationId_name_key" ON "classrooms"("organizationId", "name");
CREATE UNIQUE INDEX "classrooms_id_organizationId_key" ON "classrooms"("id", "organizationId");
CREATE INDEX "classroom_members_membershipId_idx" ON "classroom_members"("membershipId");
CREATE INDEX "classroom_members_organizationId_idx" ON "classroom_members"("organizationId");
CREATE UNIQUE INDEX "classroom_members_classroomId_membershipId_key" ON "classroom_members"("classroomId", "membershipId");
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");
CREATE INDEX "invites_organizationId_status_createdAt_idx" ON "invites"("organizationId", "status", "createdAt");
CREATE INDEX "invites_inviteeEmail_status_idx" ON "invites"("inviteeEmail", "status");
CREATE INDEX "join_requests_organizationId_status_createdAt_idx" ON "join_requests"("organizationId", "status", "createdAt");
CREATE INDEX "join_requests_userId_status_idx" ON "join_requests"("userId", "status");

-- ===========================================================================
-- Foreign keys
-- ===========================================================================

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_classroomId_organizationId_fkey" FOREIGN KEY ("classroomId", "organizationId") REFERENCES "classrooms"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invites" ADD CONSTRAINT "invites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invites" ADD CONSTRAINT "invites_classroomId_organizationId_fkey" FOREIGN KEY ("classroomId", "organizationId") REFERENCES "classrooms"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invites" ADD CONSTRAINT "invites_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invites" ADD CONSTRAINT "invites_sentByAdminId_fkey" FOREIGN KEY ("sentByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invites" ADD CONSTRAINT "invites_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Rules Prisma can't express (hand-written)
-- ===========================================================================

-- A session belongs to exactly one admin or one user, matching ownerType.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_one_owner_ck" CHECK (
  ("ownerType" = 'ADMIN' AND "adminId" IS NOT NULL AND "userId" IS NULL) OR
  ("ownerType" = 'USER' AND "userId" IS NOT NULL AND "adminId" IS NULL));

-- Without the flag, a user is in at most one organization.
ALTER TABLE "users" ADD CONSTRAINT "users_membership_limit_ck" CHECK (
  "activeMembershipCount" >= 0 AND
  ("canJoinMultipleOrganizations" OR "activeMembershipCount" <= 1));

-- Members never go over the limit.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_max_members_ck" CHECK (
  "activeMemberCount" >= 0 AND
  ("maxMembers" IS NULL OR "activeMemberCount" <= "maxMembers"));

-- An invite is sent by an organization admin or a platform admin, never both.
ALTER TABLE "invites" ADD CONSTRAINT "invites_one_sender_ck" CHECK (
  ("sentByUserId" IS NULL) <> ("sentByAdminId" IS NULL));

-- Nobody asks to become an organization admin.
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_role_ck" CHECK (
  "requestedRole" <> 'ORGANIZATION_ADMIN');

-- One pending invite per email per organization, one pending request per user per organization.
CREATE UNIQUE INDEX "invites_one_pending_uq" ON "invites"("organizationId", "inviteeEmail") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "join_requests_one_pending_uq" ON "join_requests"("userId", "organizationId") WHERE "status" = 'PENDING';

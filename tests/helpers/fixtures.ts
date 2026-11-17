// Small helpers that create rows needed by tests.
import { SUPER_ADMIN_ROLE } from "../../src/config/rbac.config.js";
import type { PageName } from "../../src/config/rbac.config.js";
import { prisma } from "./testApp.js";

let counter = 0;
const unique = () => `${Date.now()}-${++counter}`;

export async function createRole(
  name = `ROLE_${unique()}`,
  pageNames: PageName[] = []
) {
  return prisma.adminRole.create({
    data: {
      name,
      permissions: {
        create: pageNames.map((pageName) => ({ pageName, canAccess: true })),
      },
    },
  });
}

// An admin as created by the seed or another admin: not linked to Google until first sign-in.
export async function createAdmin(
  options: {
    roleName?: string;
    pages?: PageName[];
    email?: string;
    isActive?: boolean;
  } = {}
) {
  const role = await createRole(options.roleName, options.pages);
  const admin = await prisma.admin.create({
    data: {
      name: "Test Admin",
      email: options.email ?? `admin-${unique()}@buddy.test`,
      isActive: options.isActive ?? true,
      roleId: role.id,
    },
  });
  return { admin, role };
}

export const createSuperAdmin = () =>
  createAdmin({ roleName: SUPER_ADMIN_ROLE });

export async function createUser(
  options: { email?: string; googleAccountId?: string; isActive?: boolean } = {}
) {
  const id = unique();
  return prisma.user.create({
    data: {
      email: options.email ?? `user-${id}@buddy.test`,
      googleAccountId: options.googleAccountId ?? `google-user-${id}`,
      name: "Test User",
      isActive: options.isActive ?? true,
    },
  });
}

export async function createOrganization(
  options: {
    name?: string;
    maxMembers?: number | null;
    isActive?: boolean;
  } = {}
) {
  const id = unique();
  return prisma.organization.create({
    data: {
      name: options.name ?? `Green Valley School ${id}`,
      slug: `organization-${id}`,
      joinCode: `JC${id.replace(/\D/g, "").slice(-10)}`,
      maxMembers: options.maxMembers ?? null,
      isActive: options.isActive ?? true,
    },
  });
}

// Adds a membership row directly, keeping both counters right for seat-holding statuses.
export async function addMembership(
  organizationId: string,
  userId: string,
  options: {
    role?: "STUDENT" | "TEACHER" | "ORGANIZATION_ADMIN";
    status?: "ACTIVE" | "SUSPENDED" | "LEFT" | "REMOVED";
  } = {}
) {
  const status = options.status ?? "ACTIVE";
  const holdsSeat = status === "ACTIVE" || status === "SUSPENDED";
  return prisma.$transaction(async (tx) => {
    if (holdsSeat) {
      await tx.user.update({
        where: { id: userId },
        data: { activeMembershipCount: { increment: 1 } },
      });
      await tx.organization.update({
        where: { id: organizationId },
        data: { activeMemberCount: { increment: 1 } },
      });
    }
    return tx.membership.create({
      data: {
        organizationId,
        userId,
        role: options.role ?? "STUDENT",
        status,
        joinMethod: "ADDED_BY_ADMIN",
        leftAt: holdsSeat ? null : new Date(),
      },
    });
  });
}

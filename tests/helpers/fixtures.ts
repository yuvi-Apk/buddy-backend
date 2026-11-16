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

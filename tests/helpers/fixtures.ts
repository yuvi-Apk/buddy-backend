// Small helpers that create rows needed by tests.
import { SUPER_ADMIN_ROLE } from "../../src/config/rbac.config.js";
import type { PageName } from "../../src/config/rbac.config.js";
import { container, prisma } from "./testApp.js";

export const TEST_PASSWORD = "correct-horse-battery-1";

let counter = 0;
const unique = () => `${Date.now()}-${++counter}`;

export async function createRole(
  name = `ROLE_${unique()}`,
  pages: PageName[] = []
) {
  return prisma.role.create({
    data: {
      name,
      permissions: {
        create: pages.map((page) => ({ page, isAccess: true })),
      },
    },
  });
}

export async function createAdmin(
  options: {
    roleName?: string;
    pages?: PageName[];
    email?: string;
    isActive?: boolean;
  } = {}
) {
  const role = await createRole(options.roleName, options.pages);
  const admin = await prisma.adminUser.create({
    data: {
      name: "Test Admin",
      email: options.email ?? `admin-${unique()}@buddy.test`,
      passwordHash: await container.passwordHasher.hash(TEST_PASSWORD),
      isActive: options.isActive ?? true,
      roleId: role.id,
    },
  });
  return { admin, role };
}

export const createSuperAdmin = () =>
  createAdmin({ roleName: SUPER_ADMIN_ROLE });

export async function createUser(
  phone = `+9198${String(Date.now()).slice(-8)}`
) {
  return prisma.user.create({ data: { phone } });
}

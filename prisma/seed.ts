// Creates the SUPER_ADMIN role and the first super admin. Safe to run more than once:
// it never overwrites an existing admin or their password.
//   pnpm db:seed
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { SUPER_ADMIN_ROLE } from "../src/config/rbac.config.js";
import { PasswordHasher } from "../src/core/security/PasswordHasher.js";

async function main(): Promise<void> {
  const email = env.SEED_SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = env.SEED_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD in .env before seeding."
    );
  }

  const role = await prisma.role.upsert({
    where: { name: SUPER_ADMIN_ROLE },
    update: {},
    create: {
      name: SUPER_ADMIN_ROLE,
      description: "Full access. Skips all permission checks.",
    },
    select: { id: true },
  });

  const existing = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    logger.info({ email }, "Super admin already exists, nothing changed");
    return;
  }

  await prisma.adminUser.create({
    data: {
      name: "Super Admin",
      email,
      passwordHash: await new PasswordHasher().hash(password),
      roleId: role.id,
    },
    select: { id: true },
  });
  logger.info({ email }, "Super admin created");
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, "Seed failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

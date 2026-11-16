// Creates the SUPER_ADMIN role and the first super admin, who then signs in with Google
// using SEED_SUPER_ADMIN_EMAIL. Safe to run more than once: it never changes an existing admin.
//   pnpm db:seed
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { SUPER_ADMIN_ROLE } from "../src/config/rbac.config.js";

async function main(): Promise<void> {
  const email = env.SEED_SUPER_ADMIN_EMAIL?.toLowerCase();
  if (!email) {
    throw new Error("Set SEED_SUPER_ADMIN_EMAIL in .env before seeding.");
  }

  const role = await prisma.adminRole.upsert({
    where: { name: SUPER_ADMIN_ROLE },
    update: {},
    create: {
      name: SUPER_ADMIN_ROLE,
      description: "Full access. Skips all permission checks.",
    },
    select: { id: true },
  });

  // upsert with an empty update: creates once, never overwrites.
  await prisma.admin.upsert({
    where: { email },
    update: {},
    create: { name: "Super Admin", email, roleId: role.id },
    select: { id: true },
  });
  logger.info({ email }, "Super admin ready; sign in with this Google account");
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, "Seed failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

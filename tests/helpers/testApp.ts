// Shared setup for integration tests: the real app, wired to the test Postgres and Redis.
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { redis } from "../../src/config/redis.js";
import { createContainer } from "../../src/container.js";

export const container = createContainer();
export const app = createApp(container);
export { prisma, redis };

/** Empties every table and the test Redis database. Call in beforeEach. */
export async function resetState(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE "Session", "AdminUser", "User", "RolePermission", "Role" CASCADE`;
  await redis.flushdb();
}

/** Closes connections. Call in afterAll. */
export async function closeTestApp(): Promise<void> {
  await container.shutdown();
}

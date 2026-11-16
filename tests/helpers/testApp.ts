// Shared setup for integration tests: the real app, wired to the test Postgres and Redis.
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { redis } from "../../src/config/redis.js";
import { createContainer } from "../../src/container.js";
import type { OtpSender } from "../../src/core/otp/OtpSender.js";
import { PasswordHasher } from "../../src/core/security/PasswordHasher.js";

// Stands in for the SMS provider: remembers the last code sent to each phone.
class CapturingOtpSender implements OtpSender {
  readonly codes = new Map<string, string>();

  send(phone: string, code: string): Promise<void> {
    this.codes.set(phone, code);
    return Promise.resolve();
  }
}

export const otpSender = new CapturingOtpSender();
export const container = createContainer({
  otpSender,
  // Cheaper hashing keeps the test run fast. Production uses the default cost.
  passwordHasher: new PasswordHasher({ N: 2 ** 10, r: 8, p: 1 }),
});
export const app = createApp(container);
export { prisma, redis };

// Empties every table and the test Redis database. Call in beforeEach.
export async function resetState(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE "UploadedFile", "Session", "AdminUser", "User", "RolePermission", "Role" CASCADE`;
  await redis.flushdb();
  otpSender.codes.clear();
}

// Closes connections. Call in afterAll.
export async function closeTestApp(): Promise<void> {
  await container.shutdown();
}

import type { PrismaClient } from "../../config/prisma.js";

const profileSelect = {
  id: true,
  name: true,
  email: true,
  role: { select: { id: true, name: true } },
} as const;

export class AdminAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // For the login check only: this is the one method that returns the password hash.
  // Do not use it anywhere else (core-rules #9).
  findWithPasswordHashByEmail(email: string) {
    return this.prisma.adminUser.findUnique({
      where: { email },
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
        lockedUntil: true,
      },
    });
  }

  // The admin's public profile, or null when the account is missing or disabled.
  findActiveProfile(id: string) {
    return this.prisma.adminUser.findFirst({
      where: { id, isActive: true },
      select: profileSelect,
    });
  }

  // Counts a failed login. When the count reaches maxAttempts, the account is locked until
  // lockUntil and the count starts again. The increment is atomic.
  async recordFailedLogin(
    id: string,
    maxAttempts: number,
    lockUntil: Date
  ): Promise<void> {
    const { failedLoginCount } = await this.prisma.adminUser.update({
      where: { id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });

    if (failedLoginCount >= maxAttempts) {
      await this.prisma.adminUser.update({
        where: { id },
        data: { lockedUntil: lockUntil, failedLoginCount: 0 },
        select: { id: true },
      });
    }
  }

  async clearFailedLogins(id: string): Promise<void> {
    await this.prisma.adminUser.updateMany({
      where: {
        id,
        OR: [{ failedLoginCount: { gt: 0 } }, { lockedUntil: { not: null } }],
      },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }
}

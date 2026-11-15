import type { PrismaClient } from "../../config/prisma.js";

const profileSelect = { id: true, phone: true, name: true } as const;

export class UserAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns the user with this phone, creating the account on first login.
   * upsert is one statement, so two parallel first logins cannot create two users.
   */
  findOrCreateByPhone(phone: string) {
    return this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
      select: { ...profileSelect, isActive: true },
    });
  }

  /** The user's public profile, or null when the account is missing or disabled. */
  findActiveProfile(id: string) {
    return this.prisma.user.findFirst({
      where: { id, isActive: true },
      select: profileSelect,
    });
  }
}

import type { PrismaClient } from "../../config/prisma.js";
import type { AuthenticatedAdmin } from "./admin-auth.schema.js";

const profileSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  role: { select: { id: true, name: true } },
} as const;

const signInSelect = {
  id: true,
  isActive: true,
  googleAccountId: true,
} as const;

export class AdminAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findForSignInByGoogleAccountId(googleAccountId: string) {
    return this.prisma.admin.findUnique({
      where: { googleAccountId },
      select: signInSelect,
    });
  }

  findForSignInByEmail(email: string) {
    return this.prisma.admin.findUnique({
      where: { email },
      select: signInSelect,
    });
  }

  // Links the Google account on first sign-in and records the sign-in. One statement: it
  // fails (returns false) if the admin was disabled or linked to another Google account.
  async recordSignIn(input: {
    adminId: string;
    googleAccountId: string;
    avatarUrl: string | null;
  }): Promise<boolean> {
    const { count } = await this.prisma.admin.updateMany({
      where: {
        id: input.adminId,
        isActive: true,
        OR: [
          { googleAccountId: null },
          { googleAccountId: input.googleAccountId },
        ],
      },
      data: {
        googleAccountId: input.googleAccountId,
        avatarUrl: input.avatarUrl,
        lastLoginAt: new Date(),
      },
    });
    return count === 1;
  }

  // The admin's public profile, or null when the account is missing or disabled.
  findActiveProfile(adminId: string): Promise<AuthenticatedAdmin | null> {
    return this.prisma.admin.findFirst({
      where: { id: adminId, isActive: true },
      select: profileSelect,
    });
  }
}

import type { PrismaClient } from "../../config/prisma.js";
import type { GoogleIdentity } from "../../core/security/GoogleIdTokenVerifier.js";
import type { AuthenticatedUser } from "./user-auth.schema.js";

const profileSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  examCategory: true,
} as const;

export class UserAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Finds the user by Google account, creating them on first sign-in. upsert is one
  // statement, so two parallel first sign-ins can't create two users.
  upsertFromGoogle(identity: GoogleIdentity) {
    const now = new Date();
    return this.prisma.user.upsert({
      where: { googleAccountId: identity.googleAccountId },
      update: { lastLoginAt: now },
      create: {
        googleAccountId: identity.googleAccountId,
        email: identity.email,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
        lastLoginAt: now,
      },
      select: { ...profileSelect, isActive: true },
    });
  }

  async findActiveUserIdByEmail(email: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  // The user's public profile, or null when the account is missing or disabled.
  findActiveProfile(userId: string): Promise<AuthenticatedUser | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: profileSelect,
    });
  }
}

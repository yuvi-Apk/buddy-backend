import type { PrismaClient } from "../../../config/prisma.js";
import type { GoogleIdentity } from "../../../core/security/GoogleIdTokenVerifier.js";
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

  updateName(userId: string, name: string): Promise<AuthenticatedUser> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { name },
      select: profileSelect,
    });
  }

  async findAvatarUrl(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    return user?.avatarUrl ?? null;
  }

  // Changes the photo only if it is still the one the caller read, so two uploads at
  // the same time can't both win and leave a file behind. Returns false when it lost.
  async replaceAvatarUrl(
    userId: string,
    previousAvatarUrl: string | null,
    nextAvatarUrl: string | null
  ): Promise<boolean> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, avatarUrl: previousAvatarUrl },
      data: { avatarUrl: nextAvatarUrl },
    });
    return count === 1;
  }

  // The user's public profile, or null when the account is missing or disabled.
  findActiveProfile(userId: string): Promise<AuthenticatedUser | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: profileSelect,
    });
  }
}

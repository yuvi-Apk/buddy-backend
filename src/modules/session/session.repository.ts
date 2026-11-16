import type { PrismaClient } from "../../config/prisma.js";
import type {
  ClientInfo,
  SessionDto,
  SessionOwner,
  SessionOwnerType,
} from "./session.schema.js";

// Never includes the token hashes: this is what the outside world may see.
const sessionSelect = {
  id: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  deviceUserAgent: true,
  deviceIp: true,
} as const;

const ownerColumns = (owner: SessionOwner) =>
  owner.type === "ADMIN"
    ? { ownerType: owner.type, adminId: owner.id }
    : { ownerType: owner.type, userId: owner.id };

interface NewSession {
  id: string;
  owner: SessionOwner;
  refreshTokenHash: string;
  expiresAt: Date;
  client: ClientInfo;
}

const toCreateData = (session: NewSession) => ({
  id: session.id,
  ...ownerColumns(session.owner),
  refreshTokenHash: session.refreshTokenHash,
  expiresAt: session.expiresAt,
  deviceUserAgent: session.client.userAgent,
  deviceIp: session.client.ip,
});

export class SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(session: NewSession): Promise<void> {
    await this.prisma.session.create({
      data: toCreateData(session),
      select: { id: true },
    });
  }

  // Single-device sign-in: revokes the owner's other sessions and creates the new one in one
  // transaction. The advisory lock makes two parallel sign-ins of the same owner run one
  // after the other, so both can never survive. Returns the revoked session IDs.
  async replaceAllForOwner(session: NewSession): Promise<string[]> {
    const lockKey = `session-owner:${session.owner.type}:${session.owner.id}`;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const where = { ...ownerColumns(session.owner), revokedAt: null };
      const revoked = await tx.session.findMany({
        where,
        select: { id: true },
      });
      await tx.session.updateMany({ where, data: { revokedAt: new Date() } });
      await tx.session.create({
        data: toCreateData(session),
        select: { id: true },
      });
      return revoked.map((row) => row.id);
    });
  }

  // The session's owner, or null when it does not exist, is revoked or has expired.
  async findActiveOwner(id: string): Promise<SessionOwner | null> {
    const session = await this.prisma.session.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { ownerType: true, adminId: true, userId: true },
    });
    const ownerId = session?.adminId ?? session?.userId;
    return session && ownerId ? { type: session.ownerType, id: ownerId } : null;
  }

  // Swaps the refresh token in ONE statement. The WHERE clause is the check, so when two
  // requests present the same token only one of them can succeed (core-rules #3).
  async rotateRefreshToken(input: {
    id: string;
    ownerType: SessionOwnerType;
    currentHash: string;
    newHash: string;
    newExpiresAt: Date;
  }): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.session.updateMany({
      where: {
        id: input.id,
        ownerType: input.ownerType,
        refreshTokenHash: input.currentHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: input.newHash,
        previousRefreshTokenHash: input.currentHash,
        expiresAt: input.newExpiresAt,
        lastUsedAt: now,
      },
    });
    return count === 1;
  }

  // Only to detect a refresh token that was already used. Returns a hash on purpose.
  async findPreviousRefreshTokenHash(id: string): Promise<string | null> {
    const session = await this.prisma.session.findFirst({
      where: { id, revokedAt: null },
      select: { previousRefreshTokenHash: true },
    });
    return session?.previousRefreshTokenHash ?? null;
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Revokes every active session of the owner and returns their IDs.
  async revokeAllForOwner(owner: SessionOwner): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const where = { ...ownerColumns(owner), revokedAt: null };
      const sessions = await tx.session.findMany({
        where,
        select: { id: true },
      });
      await tx.session.updateMany({ where, data: { revokedAt: new Date() } });
      return sessions.map((session) => session.id);
    });
  }

  listActiveForOwner(owner: SessionOwner): Promise<SessionDto[]> {
    return this.prisma.session.findMany({
      where: {
        ...ownerColumns(owner),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: sessionSelect,
      orderBy: { lastUsedAt: "desc" },
    });
  }
}

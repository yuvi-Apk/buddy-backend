import type { PrismaClient } from "../../config/prisma.js";
import type { ClientInfo, Subject, SubjectType } from "./session.schema.js";

// Never includes the token hashes: this is what the outside world may see.
const publicSelect = {
  id: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  userAgent: true,
  ip: true,
} as const;

const subjectColumn = (subject: Subject) =>
  subject.type === "ADMIN"
    ? { adminUserId: subject.id }
    : { userId: subject.id };

export class SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    id: string;
    subject: Subject;
    refreshTokenHash: string;
    expiresAt: Date;
    client: ClientInfo;
  }): Promise<void> {
    await this.prisma.session.create({
      data: {
        id: input.id,
        subjectType: input.subject.type,
        ...subjectColumn(input.subject),
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.client.userAgent,
        ip: input.client.ip,
      },
      select: { id: true },
    });
  }

  // The session's owner, or null when it does not exist, is revoked or has expired.
  async findActiveSubject(id: string): Promise<Subject | null> {
    const session = await this.prisma.session.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { subjectType: true, adminUserId: true, userId: true },
    });
    const subjectId = session?.adminUserId ?? session?.userId;
    return session && subjectId
      ? { type: session.subjectType, id: subjectId }
      : null;
  }

  // Swaps the refresh token in ONE statement. The WHERE clause is the check, so when two
  // requests present the same token only one of them can succeed (core-rules #3).
  // Returns true when the swap happened.
  async rotateRefreshToken(input: {
    id: string;
    subjectType: SubjectType;
    currentHash: string;
    newHash: string;
    newExpiresAt: Date;
  }): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.session.updateMany({
      where: {
        id: input.id,
        subjectType: input.subjectType,
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

  // Used only to detect a refresh token that was already used. Returns hashes on purpose.
  async findPreviousTokenHash(id: string): Promise<string | null> {
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

  // Revokes every active session of a subject and returns their IDs.
  async revokeAllForSubject(subject: Subject): Promise<string[]> {
    const where = {
      ...subjectColumn(subject),
      subjectType: subject.type,
      revokedAt: null,
    };
    const sessions = await this.prisma.session.findMany({
      where,
      select: { id: true },
    });
    await this.prisma.session.updateMany({
      where,
      data: { revokedAt: new Date() },
    });
    return sessions.map((session) => session.id);
  }

  listActiveForSubject(subject: Subject) {
    return this.prisma.session.findMany({
      where: {
        ...subjectColumn(subject),
        subjectType: subject.type,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: publicSelect,
      orderBy: { lastUsedAt: "desc" },
    });
  }
}

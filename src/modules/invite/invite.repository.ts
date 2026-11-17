import type { PrismaClient } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { toSkipTake } from "../../utils/pagination.js";
import type {
  InviteDto,
  InviteRole,
  InviteStatus,
  ListInvitesQuery,
  ListReceivedInvitesQuery,
  ReceivedInviteDto,
} from "./invite.schema.js";

const inviteSelect = {
  id: true,
  inviteeEmail: true,
  roleOnJoin: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  classroom: { select: { id: true, name: true } },
} as const;

interface InviteRow {
  id: string;
  inviteeEmail: string;
  roleOnJoin: InviteRole;
  status: InviteStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  classroom: { id: string; name: string } | null;
}

// A PENDING invite past expiresAt is shown as EXPIRED; the row is updated lazily.
const toDto = (row: InviteRow, now = new Date()): InviteDto => ({
  ...row,
  status:
    row.status === "PENDING" && row.expiresAt <= now ? "EXPIRED" : row.status,
});

function statusFilter(
  status: InviteStatus | undefined,
  now: Date
): Prisma.InviteWhereInput {
  switch (status) {
    case undefined:
      return {};
    case "PENDING":
      return { status: "PENDING", expiresAt: { gt: now } };
    case "EXPIRED":
      return {
        OR: [
          { status: "EXPIRED" },
          { status: "PENDING", expiresAt: { lte: now } },
        ],
      };
    default:
      return { status };
  }
}

// What accepting needs. Never leaves the module.
export interface InviteForAccept {
  id: string;
  organizationId: string;
  classroomId: string | null;
  inviteeEmail: string;
  roleOnJoin: InviteRole;
  status: InviteStatus;
  expiresAt: Date;
}

const inviteForAcceptSelect = {
  id: true,
  organizationId: true,
  classroomId: true,
  inviteeEmail: true,
  roleOnJoin: true,
  status: true,
  expiresAt: true,
} as const;

export class InviteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Creates the invite. An older PENDING invite to the same email that has expired is marked
  // EXPIRED first, so it doesn't hit the one-pending-invite index (invites_one_pending_uq).
  async create(input: {
    organizationId: string;
    inviteeEmail: string;
    roleOnJoin: InviteRole;
    classroomId?: string;
    tokenHash: string;
    expiresAt: Date;
    sentBy: { userId: string } | { adminId: string };
  }): Promise<InviteDto> {
    const { sentBy, ...fields } = input;
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.invite.updateMany({
        where: {
          organizationId: input.organizationId,
          inviteeEmail: input.inviteeEmail,
          status: "PENDING",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });
      return tx.invite.create({
        data: {
          ...fields,
          ...("userId" in sentBy
            ? { sentByUserId: sentBy.userId }
            : { sentByAdminId: sentBy.adminId }),
        },
        select: inviteSelect,
      });
    });
    return toDto(row, now);
  }

  async list(
    organizationId: string,
    query: ListInvitesQuery
  ): Promise<{ items: InviteDto[]; total: number }> {
    const now = new Date();
    const where: Prisma.InviteWhereInput = {
      organizationId,
      ...statusFilter(query.status, now),
    };
    const [rows, total] = await Promise.all([
      this.prisma.invite.findMany({
        where,
        select: inviteSelect,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(query),
      }),
      this.prisma.invite.count({ where }),
    ]);
    return { items: rows.map((row) => toDto(row, now)), total };
  }

  // Only a PENDING invite can be revoked (an expired one too, which makes no difference).
  async revoke(
    organizationId: string,
    inviteId: string
  ): Promise<InviteDto | "NOT_FOUND" | "NOT_PENDING"> {
    const { count } = await this.prisma.invite.updateMany({
      where: { id: inviteId, organizationId, status: "PENDING" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const row = await this.prisma.invite.findFirst({
      where: { id: inviteId, organizationId },
      select: inviteSelect,
    });
    if (!row) return "NOT_FOUND";
    return count === 0 ? "NOT_PENDING" : toDto(row);
  }

  // Invites waiting for this email, in active organizations.
  async listReceived(
    inviteeEmail: string,
    query: ListReceivedInvitesQuery
  ): Promise<{ items: ReceivedInviteDto[]; total: number }> {
    const where: Prisma.InviteWhereInput = {
      inviteeEmail,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      organization: { isActive: true },
    };
    const [items, total] = await Promise.all([
      this.prisma.invite.findMany({
        where,
        select: {
          id: true,
          roleOnJoin: true,
          expiresAt: true,
          organization: { select: { id: true, name: true, type: true } },
          classroom: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        ...toSkipTake(query),
      }),
      this.prisma.invite.count({ where }),
    ]);
    return { items, total };
  }

  findForAcceptByTokenHash(tokenHash: string): Promise<InviteForAccept | null> {
    return this.prisma.invite.findUnique({
      where: { tokenHash },
      select: inviteForAcceptSelect,
    });
  }

  findForAcceptById(
    inviteId: string,
    inviteeEmail: string
  ): Promise<InviteForAccept | null> {
    return this.prisma.invite.findFirst({
      where: { id: inviteId, inviteeEmail },
      select: inviteForAcceptSelect,
    });
  }

  // Claims the invite before joining, so a parallel revoke or second accept can't also
  // succeed: only one statement can move it out of PENDING.
  async claim(inviteId: string, userId: string): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.invite.updateMany({
      where: { id: inviteId, status: "PENDING", expiresAt: { gt: now } },
      data: { status: "ACCEPTED", acceptedByUserId: userId, acceptedAt: now },
    });
    return count === 1;
  }

  // Puts a claimed invite back when joining was refused (for example, no free seats).
  async releaseClaim(inviteId: string): Promise<void> {
    await this.prisma.invite.updateMany({
      where: { id: inviteId, status: "ACCEPTED" },
      data: { status: "PENDING", acceptedByUserId: null, acceptedAt: null },
    });
  }

  async markExpired(inviteId: string): Promise<void> {
    await this.prisma.invite.updateMany({
      where: { id: inviteId, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
  }
}

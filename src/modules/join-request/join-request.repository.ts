import type { PrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { toSkipTake } from "../../utils/pagination.js";
import type {
  JoinRequestForReviewDto,
  ListJoinRequestsQuery,
  MyJoinRequestDto,
  RequestableRole,
} from "./join-request.schema.js";

const myJoinRequestSelect = {
  id: true,
  requestedRole: true,
  status: true,
  requesterNote: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true, type: true } },
} as const;

const reviewSelect = {
  id: true,
  requestedRole: true,
  status: true,
  requesterNote: true,
  sharePastDataWithOrganization: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const;

// The requested role is never ORGANIZATION_ADMIN (CHECK constraint), so the row type narrows.
type Row<T> = Omit<T, "requestedRole"> & { requestedRole: string };
const narrow = <T extends { requestedRole: RequestableRole }>(row: Row<T>) =>
  row as T;

// What approving needs. Never leaves the module.
export interface JoinRequestForApproval {
  id: string;
  userId: string;
  requestedRole: RequestableRole;
  sharePastDataWithOrganization: boolean;
}

export class JoinRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ===========================================================================
  // The person asking
  // ===========================================================================

  // "DUPLICATE" when this user already has a PENDING request here (join_requests_one_pending_uq).
  async create(input: {
    userId: string;
    organizationId: string;
    requestedRole: RequestableRole;
    requesterNote?: string;
    sharePastDataWithOrganization: boolean;
  }): Promise<MyJoinRequestDto | "DUPLICATE"> {
    try {
      const row = await this.prisma.joinRequest.create({
        data: input,
        select: myJoinRequestSelect,
      });
      return narrow<MyJoinRequestDto>(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return "DUPLICATE";
      }
      throw err;
    }
  }

  async listMine(
    userId: string,
    query: ListJoinRequestsQuery
  ): Promise<{ items: MyJoinRequestDto[]; total: number }> {
    const where: Prisma.JoinRequestWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.joinRequest.findMany({
        where,
        select: myJoinRequestSelect,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(query),
      }),
      this.prisma.joinRequest.count({ where }),
    ]);
    return { items: rows.map((row) => narrow<MyJoinRequestDto>(row)), total };
  }

  // Only the requester's own PENDING request.
  async cancel(
    userId: string,
    joinRequestId: string
  ): Promise<MyJoinRequestDto | "NOT_FOUND" | "NOT_PENDING"> {
    const { count } = await this.prisma.joinRequest.updateMany({
      where: { id: joinRequestId, userId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    const row = await this.prisma.joinRequest.findFirst({
      where: { id: joinRequestId, userId },
      select: myJoinRequestSelect,
    });
    if (!row) return "NOT_FOUND";
    return count === 0 ? "NOT_PENDING" : narrow<MyJoinRequestDto>(row);
  }

  // ===========================================================================
  // Organization admins (every method takes organizationId)
  // ===========================================================================

  async listForReview(
    organizationId: string,
    query: ListJoinRequestsQuery
  ): Promise<{ items: JoinRequestForReviewDto[]; total: number }> {
    const where: Prisma.JoinRequestWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.joinRequest.findMany({
        where,
        select: reviewSelect,
        orderBy: { createdAt: "asc" }, // oldest first: a queue
        ...toSkipTake(query),
      }),
      this.prisma.joinRequest.count({ where }),
    ]);
    return {
      items: rows.map((row) => narrow<JoinRequestForReviewDto>(row)),
      total,
    };
  }

  async findForReview(
    organizationId: string,
    joinRequestId: string
  ): Promise<JoinRequestForReviewDto | null> {
    const row = await this.prisma.joinRequest.findFirst({
      where: { id: joinRequestId, organizationId },
      select: reviewSelect,
    });
    return row ? narrow<JoinRequestForReviewDto>(row) : null;
  }

  async findPendingForApproval(
    organizationId: string,
    joinRequestId: string
  ): Promise<JoinRequestForApproval | null> {
    const row = await this.prisma.joinRequest.findFirst({
      where: { id: joinRequestId, organizationId, status: "PENDING" },
      select: {
        id: true,
        userId: true,
        requestedRole: true,
        sharePastDataWithOrganization: true,
      },
    });
    return row ? narrow<JoinRequestForApproval>(row) : null;
  }

  // Moves a PENDING request to APPROVED or REJECTED. Only one review (or the requester's
  // cancel) can win, because each is a conditional update on status = PENDING.
  async review(input: {
    organizationId: string;
    joinRequestId: string;
    status: "APPROVED" | "REJECTED";
    reviewedByUserId: string;
    reviewNote?: string;
  }): Promise<boolean> {
    const { count } = await this.prisma.joinRequest.updateMany({
      where: {
        id: input.joinRequestId,
        organizationId: input.organizationId,
        status: "PENDING",
      },
      data: {
        status: input.status,
        reviewedByUserId: input.reviewedByUserId,
        reviewNote: input.reviewNote ?? null,
        reviewedAt: new Date(),
      },
    });
    return count === 1;
  }

  // Puts an approval back to PENDING when joining was refused (for example, no free seats).
  async releaseApproval(joinRequestId: string): Promise<void> {
    await this.prisma.joinRequest.updateMany({
      where: { id: joinRequestId, status: "APPROVED" },
      data: {
        status: "PENDING",
        reviewedByUserId: null,
        reviewNote: null,
        reviewedAt: null,
      },
    });
  }
}

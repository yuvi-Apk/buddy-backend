import type { PrismaClient } from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { toSkipTake } from "../../../utils/pagination.js";
import type {
  ActiveMembership,
  JoinCodeDto,
  JoinMethod,
  ListMembersQuery,
  ListMyOrganizationsQuery,
  ListOrganizationsQuery,
  MemberDto,
  MembershipRole,
  MembershipSettingsDto,
  MembershipStatus,
  MyOrganizationDto,
  OrganizationDto,
  OrganizationType,
} from "./organization.schema.js";

const organizationSelect = {
  id: true,
  name: true,
  type: true,
  slug: true,
  joinCode: true,
  isJoinCodeEnabled: true,
  plan: true,
  maxMembers: true,
  activeMemberCount: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const memberSelect = {
  id: true,
  role: true,
  status: true,
  joinMethod: true,
  joinedAt: true,
  leftAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const;

const membershipSettingsSelect = {
  id: true,
  canJoinMultipleOrganizations: true,
  activeMembershipCount: true,
} as const;

// ACTIVE and SUSPENDED hold a seat; LEFT and REMOVED don't.
const SEAT_HOLDING_STATUSES: MembershipStatus[] = ["ACTIVE", "SUSPENDED"];
const FORMER_STATUSES: MembershipStatus[] = ["LEFT", "REMOVED"];

export type JoinRefusal =
  | "USER_NOT_FOUND"
  | "USER_IN_ANOTHER_ORGANIZATION"
  | "ORGANIZATION_NOT_FOUND"
  | "ORGANIZATION_INACTIVE"
  | "ORGANIZATION_FULL"
  | "ALREADY_MEMBER";

export interface JoinOrganizationInput {
  organizationId: string;
  userId: string;
  role: MembershipRole;
  joinMethod: JoinMethod;
  sharePastDataWithOrganization: boolean;
}

// Thrown inside the join transaction so every write in it rolls back.
class JoinRefusedError extends Error {
  constructor(readonly reason: JoinRefusal) {
    super(reason);
  }
}

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

type TransactionClient = Prisma.TransactionClient;

// Serialises every change that could take away an organization's last ACTIVE admin.
async function lockOrganizationAdmins(
  tx: TransactionClient,
  organizationId: string
): Promise<void> {
  const lockKey = `organization-admins:${organizationId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

// Sets a seat-holding membership to LEFT or REMOVED, frees the seat on both counters and
// takes the member out of every classroom. Conditional, so a seat is never freed twice.
async function endMembership(
  tx: TransactionClient,
  organizationId: string,
  membershipId: string,
  status: "LEFT" | "REMOVED"
): Promise<boolean> {
  const membership = await tx.membership.findFirst({
    where: { id: membershipId, organizationId },
    select: { userId: true },
  });
  if (!membership) return false;

  const { count } = await tx.membership.updateMany({
    where: {
      id: membershipId,
      organizationId,
      status: { in: SEAT_HOLDING_STATUSES },
    },
    data: { status, leftAt: new Date() },
  });
  if (count === 0) return false;

  await tx.user.updateMany({
    where: { id: membership.userId, activeMembershipCount: { gt: 0 } },
    data: { activeMembershipCount: { decrement: 1 } },
  });
  await tx.organization.updateMany({
    where: { id: organizationId, activeMemberCount: { gt: 0 } },
    data: { activeMemberCount: { decrement: 1 } },
  });
  // Classroom places end with the membership; rejoining starts with no classrooms.
  await tx.classroomMember.deleteMany({
    where: { membershipId, organizationId },
  });
  return true;
}

export class OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ===========================================================================
  // Organizations
  // ===========================================================================

  async listOrganizations(
    query: ListOrganizationsQuery
  ): Promise<{ items: OrganizationDto[]; total: number }> {
    const where: Prisma.OrganizationWhereInput = {
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        select: organizationSelect,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(query),
      }),
      this.prisma.organization.count({ where }),
    ]);
    return { items, total };
  }

  findOrganizationById(id: string): Promise<OrganizationDto | null> {
    return this.prisma.organization.findUnique({
      where: { id },
      select: organizationSelect,
    });
  }

  createOrganization(input: {
    name: string;
    type: OrganizationType;
    slug: string;
    maxMembers: number | null;
    joinCode: string;
    createdByAdminId: string;
  }): Promise<OrganizationDto> {
    return this.prisma.organization.create({
      data: input,
      select: organizationSelect,
    });
  }

  // A new maxMembers is only written when it is not below the current member count:
  // the WHERE clause is the check (core-rules #3).
  async updateOrganization(
    id: string,
    fields: {
      name?: string;
      type?: OrganizationType;
      slug?: string;
      maxMembers?: number | null;
      isJoinCodeEnabled?: boolean;
      isActive?: boolean;
      joinCode?: string;
    }
  ): Promise<OrganizationDto | "NOT_FOUND" | "BELOW_MEMBER_COUNT"> {
    const { count } = await this.prisma.organization.updateMany({
      where: {
        id,
        ...(typeof fields.maxMembers === "number"
          ? { activeMemberCount: { lte: fields.maxMembers } }
          : {}),
      },
      data: fields,
    });
    const organization = await this.findOrganizationById(id);
    if (!organization) return "NOT_FOUND";
    return count === 0 ? "BELOW_MEMBER_COUNT" : organization;
  }

  // Only an active organization with its join code switched on.
  findJoinableByCode(
    joinCode: string
  ): Promise<{ id: string; name: string; type: OrganizationType } | null> {
    return this.prisma.organization.findFirst({
      where: { joinCode, isActive: true, isJoinCodeEnabled: true },
      select: { id: true, name: true, type: true },
    });
  }

  findJoinCode(organizationId: string): Promise<JoinCodeDto | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { joinCode: true, isJoinCodeEnabled: true },
    });
  }

  // ===========================================================================
  // Memberships
  // ===========================================================================

  async listMembers(
    organizationId: string,
    query: ListMembersQuery
  ): Promise<{ items: MemberDto[]; total: number }> {
    const where: Prisma.MembershipWhereInput = {
      organizationId,
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        select: memberSelect,
        orderBy: { joinedAt: "desc" },
        ...toSkipTake(query),
      }),
      this.prisma.membership.count({ where }),
    ]);
    return { items, total };
  }

  findMember(
    organizationId: string,
    userId: string
  ): Promise<MemberDto | null> {
    return this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: memberSelect,
    });
  }

  // For requireOrganizationRole: a seat-holding membership in an active organization.
  async findSeatHoldingMembership(
    organizationId: string,
    userId: string
  ): Promise<(ActiveMembership & { status: MembershipStatus }) | null> {
    return this.prisma.membership.findFirst({
      where: {
        organizationId,
        userId,
        status: { in: SEAT_HOLDING_STATUSES },
        organization: { isActive: true },
      },
      select: { id: true, organizationId: true, role: true, status: true },
    });
  }

  async listMyOrganizations(
    userId: string,
    query: ListMyOrganizationsQuery
  ): Promise<{ items: MyOrganizationDto[]; total: number }> {
    const where: Prisma.MembershipWhereInput = {
      userId,
      status: { in: SEAT_HOLDING_STATUSES },
      organization: { isActive: true },
    };
    const [rows, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        select: {
          id: true,
          role: true,
          status: true,
          joinedAt: true,
          organization: {
            select: { id: true, name: true, type: true, slug: true },
          },
        },
        orderBy: { joinedAt: "asc" },
        ...toSkipTake(query),
      }),
      this.prisma.membership.count({ where }),
    ]);
    const items = rows.map(({ organization, ...membership }) => ({
      organization,
      membership,
    }));
    return { items, total };
  }

  // The join rule, used by every way of joining. One transaction:
  //   1. the user has room (no seat-holding membership, or canJoinMultipleOrganizations)
  //   2. the organization is active and has a free seat
  //   3. the membership is created, or a LEFT / REMOVED one is reactivated
  // Steps 1 and 2 are conditional updateMany calls (core-rules #3); the row locks they take
  // make parallel joins wait for each other. Any refusal rolls back all three.
  async joinOrganization(
    input: JoinOrganizationInput
  ): Promise<{ member: MemberDto } | { refusedBecause: JoinRefusal }> {
    const { organizationId, userId } = input;
    try {
      const member = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
          select: { id: true, status: true },
        });
        if (existing && SEAT_HOLDING_STATUSES.includes(existing.status)) {
          throw new JoinRefusedError("ALREADY_MEMBER");
        }

        const userSlot = await tx.user.updateMany({
          where: {
            id: userId,
            isActive: true,
            OR: [
              { activeMembershipCount: 0 },
              { canJoinMultipleOrganizations: true },
            ],
          },
          data: { activeMembershipCount: { increment: 1 } },
        });
        if (userSlot.count === 0) {
          const user = await tx.user.findFirst({
            where: { id: userId, isActive: true },
            select: { id: true },
          });
          throw new JoinRefusedError(
            user ? "USER_IN_ANOTHER_ORGANIZATION" : "USER_NOT_FOUND"
          );
        }

        const seat = await tx.organization.updateMany({
          where: {
            id: organizationId,
            isActive: true,
            OR: [
              { maxMembers: null },
              {
                activeMemberCount: {
                  lt: tx.organization.fields.maxMembers,
                },
              },
            ],
          },
          data: { activeMemberCount: { increment: 1 } },
        });
        if (seat.count === 0) {
          const organization = await tx.organization.findUnique({
            where: { id: organizationId },
            select: { isActive: true },
          });
          throw new JoinRefusedError(
            !organization
              ? "ORGANIZATION_NOT_FOUND"
              : organization.isActive
                ? "ORGANIZATION_FULL"
                : "ORGANIZATION_INACTIVE"
          );
        }

        const membershipFields = {
          role: input.role,
          status: "ACTIVE" as const,
          joinMethod: input.joinMethod,
          sharePastDataWithOrganization: input.sharePastDataWithOrganization,
          joinedAt: new Date(),
          leftAt: null,
        };
        if (!existing) {
          return tx.membership.create({
            data: { organizationId, userId, ...membershipFields },
            select: memberSelect,
          });
        }
        // Conditional, so a parallel reactivation can't count the seat twice.
        const reactivated = await tx.membership.updateMany({
          where: { id: existing.id, status: { in: FORMER_STATUSES } },
          data: membershipFields,
        });
        if (reactivated.count === 0) {
          throw new JoinRefusedError("ALREADY_MEMBER");
        }
        return tx.membership.findUniqueOrThrow({
          where: { id: existing.id },
          select: memberSelect,
        });
      });
      return { member };
    } catch (err) {
      if (err instanceof JoinRefusedError)
        return { refusedBecause: err.reason };
      // A parallel join created the same membership first.
      if (isUniqueViolation(err)) return { refusedBecause: "ALREADY_MEMBER" };
      throw err;
    }
  }

  // Only an ACTIVE membership is promoted; returns false otherwise.
  // Read-only early check for a nicer error; the join rule re-checks atomically.
  async hasRoomForAnotherMembership(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        OR: [
          { activeMembershipCount: 0 },
          { canJoinMultipleOrganizations: true },
        ],
      },
      select: { id: true },
    });
    return user !== null;
  }

  async promoteToOrganizationAdmin(
    organizationId: string,
    userId: string
  ): Promise<boolean> {
    const { count } = await this.prisma.membership.updateMany({
      where: { organizationId, userId, status: "ACTIVE" },
      data: { role: "ORGANIZATION_ADMIN" },
    });
    return count === 1;
  }

  // A seat-holding membership by id, for other modules (classroom).
  findSeatHoldingMember(
    organizationId: string,
    membershipId: string
  ): Promise<{
    id: string;
    role: MembershipRole;
    status: MembershipStatus;
  } | null> {
    return this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        status: { in: SEAT_HOLDING_STATUSES },
      },
      select: { id: true, role: true, status: true },
    });
  }

  // An organization admin changes, suspends or removes another member. Runs under the
  // organization's admin lock, and first checks the actor is still an ACTIVE organization
  // admin: two admins demoting each other at once can't leave the organization without one.
  async changeMemberAsOrganizationAdmin(input: {
    organizationId: string;
    actorMembershipId: string;
    targetMembershipId: string;
    change:
      { role?: MembershipRole; status?: "ACTIVE" | "SUSPENDED" } | "REMOVE";
  }): Promise<MemberDto | "REMOVED" | "NOT_FOUND" | "ACTOR_NOT_ADMIN"> {
    const { organizationId, targetMembershipId, change } = input;
    return this.prisma.$transaction(async (tx) => {
      await lockOrganizationAdmins(tx, organizationId);

      const actor = await tx.membership.findFirst({
        where: {
          id: input.actorMembershipId,
          organizationId,
          role: "ORGANIZATION_ADMIN",
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!actor) return "ACTOR_NOT_ADMIN";

      if (change === "REMOVE") {
        const ended = await endMembership(
          tx,
          organizationId,
          targetMembershipId,
          "REMOVED"
        );
        return ended ? "REMOVED" : "NOT_FOUND";
      }

      const { count } = await tx.membership.updateMany({
        where: {
          id: targetMembershipId,
          organizationId,
          status: { in: SEAT_HOLDING_STATUSES },
        },
        data: change,
      });
      if (count === 0) return "NOT_FOUND";
      return tx.membership.findUniqueOrThrow({
        where: { id: targetMembershipId },
        select: memberSelect,
      });
    });
  }

  // The caller leaves. The last ACTIVE organization admin can't, so an organization always keeps one.
  async leaveOrganization(
    organizationId: string,
    membershipId: string
  ): Promise<"LEFT" | "NOT_FOUND" | "LAST_ADMIN"> {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganizationAdmins(tx, organizationId);

      const membership = await tx.membership.findFirst({
        where: {
          id: membershipId,
          organizationId,
          status: { in: SEAT_HOLDING_STATUSES },
        },
        select: { role: true, status: true },
      });
      if (!membership) return "NOT_FOUND";

      if (
        membership.role === "ORGANIZATION_ADMIN" &&
        membership.status === "ACTIVE"
      ) {
        const otherActiveAdmins = await tx.membership.count({
          where: {
            organizationId,
            id: { not: membershipId },
            role: "ORGANIZATION_ADMIN",
            status: "ACTIVE",
          },
        });
        if (otherActiveAdmins === 0) return "LAST_ADMIN";
      }

      const ended = await endMembership(
        tx,
        organizationId,
        membershipId,
        "LEFT"
      );
      return ended ? "LEFT" : "NOT_FOUND";
    });
  }

  // ===========================================================================
  // Per-user membership settings (columns on users that only this module changes)
  // ===========================================================================

  // Turning the flag off is only written while the user holds at most one membership.
  async updateMembershipSettings(
    userId: string,
    canJoinMultipleOrganizations: boolean
  ): Promise<MembershipSettingsDto | "NOT_FOUND" | "IN_SEVERAL_ORGANIZATIONS"> {
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: userId,
        ...(canJoinMultipleOrganizations
          ? {}
          : { activeMembershipCount: { lte: 1 } }),
      },
      data: { canJoinMultipleOrganizations },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: membershipSettingsSelect,
    });
    if (!user) return "NOT_FOUND";
    if (count === 0) return "IN_SEVERAL_ORGANIZATIONS";
    const { id, ...settings } = user;
    return { userId: id, ...settings };
  }
}

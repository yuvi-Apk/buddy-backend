import type { PrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { toSkipTake } from "../../utils/pagination.js";
import type {
  ClassroomDto,
  ClassroomMemberDto,
  ListClassroomMembersQuery,
  ListClassroomsQuery,
} from "./classroom.schema.js";

// Members whose membership ended are taken out of classrooms when it ends; the status
// filter also hides a row added in the same moment the membership ended.
const seatHoldingMembership = {
  membership: { status: { in: ["ACTIVE" as const, "SUSPENDED" as const] } },
};

const classroomSelect = {
  id: true,
  name: true,
  academicYear: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: { where: seatHoldingMembership } } },
} as const;

interface ClassroomRow {
  id: string;
  name: string;
  academicYear: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { members: number };
}

const toDto = ({ _count, ...classroom }: ClassroomRow): ClassroomDto => ({
  ...classroom,
  memberCount: _count.members,
});

// Every method takes organizationId, so a classroom of another organization is never found.
export class ClassroomRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // onlyForMembershipId: limit to classrooms this member is in (teachers and students).
  async list(
    organizationId: string,
    query: ListClassroomsQuery,
    onlyForMembershipId?: string
  ): Promise<{ items: ClassroomDto[]; total: number }> {
    const where: Prisma.ClassroomWhereInput = {
      organizationId,
      isArchived: query.isArchived,
      ...(query.search
        ? { name: { contains: query.search, mode: "insensitive" } }
        : {}),
      ...(onlyForMembershipId
        ? { members: { some: { membershipId: onlyForMembershipId } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.classroom.findMany({
        where,
        select: classroomSelect,
        orderBy: { name: "asc" },
        ...toSkipTake(query),
      }),
      this.prisma.classroom.count({ where }),
    ]);
    return { items: rows.map(toDto), total };
  }

  async findById(
    organizationId: string,
    classroomId: string,
    onlyForMembershipId?: string
  ): Promise<ClassroomDto | null> {
    const row = await this.prisma.classroom.findFirst({
      where: {
        id: classroomId,
        organizationId,
        ...(onlyForMembershipId
          ? { members: { some: { membershipId: onlyForMembershipId } } }
          : {}),
      },
      select: classroomSelect,
    });
    return row ? toDto(row) : null;
  }

  async create(
    organizationId: string,
    input: { name: string; academicYear?: string }
  ): Promise<ClassroomDto> {
    const row = await this.prisma.classroom.create({
      data: { organizationId, ...input },
      select: classroomSelect,
    });
    return toDto(row);
  }

  async update(
    organizationId: string,
    classroomId: string,
    fields: {
      name?: string;
      academicYear?: string | null;
      isArchived?: boolean;
    }
  ): Promise<ClassroomDto | null> {
    const { count } = await this.prisma.classroom.updateMany({
      where: { id: classroomId, organizationId },
      data: fields,
    });
    return count === 0 ? null : this.findById(organizationId, classroomId);
  }

  async listMembers(
    organizationId: string,
    classroomId: string,
    query: ListClassroomMembersQuery
  ): Promise<{ items: ClassroomMemberDto[]; total: number }> {
    const where: Prisma.ClassroomMemberWhereInput = {
      organizationId,
      classroomId,
      membership: {
        status: { in: ["ACTIVE", "SUSPENDED"] },
        ...(query.role ? { role: query.role } : {}),
      },
    };
    const [rows, total] = await Promise.all([
      this.prisma.classroomMember.findMany({
        where,
        select: {
          membershipId: true,
          createdAt: true,
          membership: {
            select: {
              role: true,
              user: {
                select: { id: true, name: true, email: true, avatarUrl: true },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        ...toSkipTake(query),
      }),
      this.prisma.classroomMember.count({ where }),
    ]);
    const items = rows.map(({ membershipId, createdAt, membership }) => ({
      membershipId,
      role: membership.role,
      addedAt: createdAt,
      user: membership.user,
    }));
    return { items, total };
  }

  async isMember(
    organizationId: string,
    classroomId: string,
    membershipId: string
  ): Promise<boolean> {
    const row = await this.prisma.classroomMember.findFirst({
      where: { organizationId, classroomId, membershipId },
      select: { id: true },
    });
    return row !== null;
  }

  // false when the member is already in the classroom (unique index).
  async addMember(
    organizationId: string,
    classroomId: string,
    membershipId: string
  ): Promise<boolean> {
    try {
      await this.prisma.classroomMember.create({
        data: { organizationId, classroomId, membershipId },
        select: { id: true },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return false;
      }
      throw err;
    }
  }

  async removeMember(
    organizationId: string,
    classroomId: string,
    membershipId: string
  ): Promise<boolean> {
    const { count } = await this.prisma.classroomMember.deleteMany({
      where: { organizationId, classroomId, membershipId },
    });
    return count === 1;
  }
}

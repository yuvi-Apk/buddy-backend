import { SUPER_ADMIN_ROLE } from "../../config/rbac.config.js";
import type { PrismaClient } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { toSkipTake } from "../../utils/pagination.js";
import type { AdminDto, ListAdminsQuery } from "./admin.schema.js";

const adminSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  isActive: true,
  googleAccountId: true, // only to compute isGoogleLinked
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true } },
} as const;

interface AdminRow extends Omit<AdminDto, "isGoogleLinked"> {
  googleAccountId: string | null;
}

const toDto = ({ googleAccountId, ...admin }: AdminRow): AdminDto => ({
  ...admin,
  isGoogleLinked: googleAccountId !== null,
});

// Thrown inside the update transaction to roll it back.
class NoSuperAdminLeftError extends Error {}

export class AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    query: ListAdminsQuery
  ): Promise<{ items: AdminDto[]; total: number }> {
    const where: Prisma.AdminWhereInput = {
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.admin.findMany({
        where,
        select: adminSelect,
        orderBy: { name: "asc" },
        ...toSkipTake(query),
      }),
      this.prisma.admin.count({ where }),
    ]);
    return { items: rows.map(toDto), total };
  }

  async findById(id: string): Promise<AdminDto | null> {
    const row = await this.prisma.admin.findUnique({
      where: { id },
      select: adminSelect,
    });
    return row ? toDto(row) : null;
  }

  // A duplicate email hits the unique index: 409 in errorHandler.
  async create(input: {
    name: string;
    email: string;
    roleId: string;
  }): Promise<AdminDto> {
    const row = await this.prisma.admin.create({
      data: input,
      select: adminSelect,
    });
    return toDto(row);
  }

  // Applies the change, then checks an active SUPER_ADMIN still exists, all under one
  // advisory lock: two super admins demoting or disabling each other at once can't both win.
  async update(
    id: string,
    fields: { name?: string; roleId?: string; isActive?: boolean }
  ): Promise<AdminDto | "NOT_FOUND" | "NO_SUPER_ADMIN_LEFT"> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('super-admins', 0))`;

        const { count } = await tx.admin.updateMany({
          where: { id },
          data: fields,
        });
        if (count === 0) return "NOT_FOUND";

        const activeSuperAdmins = await tx.admin.count({
          where: { isActive: true, role: { name: SUPER_ADMIN_ROLE } },
        });
        if (activeSuperAdmins === 0) throw new NoSuperAdminLeftError();

        const row = await tx.admin.findUniqueOrThrow({
          where: { id },
          select: adminSelect,
        });
        return toDto(row);
      });
    } catch (err) {
      if (err instanceof NoSuperAdminLeftError) return "NO_SUPER_ADMIN_LEFT";
      throw err;
    }
  }
}

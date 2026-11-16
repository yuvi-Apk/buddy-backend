import type { PrismaClient } from "../../config/prisma.js";
import type { RolePagesLoader } from "../../core/permissions/PermissionService.js";
import { toSkipTake } from "../../utils/pagination.js";
import type { ListRolesQuery, RoleDto } from "./role.schema.js";

const roleSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  permissions: { where: { canAccess: true }, select: { pageName: true } },
} as const;

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  permissions: { pageName: string }[];
}

const toDto = ({ permissions, ...role }: RoleRow): RoleDto => ({
  ...role,
  pages: permissions.map((permission) => permission.pageName).sort(),
});

export class RoleRepository implements RolePagesLoader {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    query: ListRolesQuery
  ): Promise<{ items: RoleDto[]; total: number }> {
    const where = query.search
      ? { name: { contains: query.search, mode: "insensitive" as const } }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.adminRole.findMany({
        where,
        select: roleSelect,
        orderBy: { name: "asc" },
        ...toSkipTake(query),
      }),
      this.prisma.adminRole.count({ where }),
    ]);
    return { items: rows.map(toDto), total };
  }

  async findById(id: string): Promise<RoleDto | null> {
    const row = await this.prisma.adminRole.findUnique({
      where: { id },
      select: roleSelect,
    });
    return row ? toDto(row) : null;
  }

  async create(input: {
    name: string;
    description?: string;
    pages: string[];
  }): Promise<RoleDto> {
    const row = await this.prisma.adminRole.create({
      data: {
        name: input.name,
        description: input.description,
        permissions: {
          create: input.pages.map((pageName) => ({
            pageName,
            canAccess: true,
          })),
        },
      },
      select: roleSelect,
    });
    return toDto(row);
  }

  // Updates the role and, when pages are given, replaces its permissions in one transaction.
  async update(
    id: string,
    input: { name?: string; description?: string | null; pages?: string[] }
  ): Promise<RoleDto> {
    const { pages, ...fields } = input;

    const row = await this.prisma.$transaction(async (tx) => {
      if (pages) {
        await tx.adminPermission.deleteMany({ where: { roleId: id } });
        await tx.adminPermission.createMany({
          data: pages.map((pageName) => ({
            roleId: id,
            pageName,
            canAccess: true,
          })),
        });
      }
      return tx.adminRole.update({
        where: { id },
        data: fields,
        select: roleSelect,
      });
    });
    return toDto(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.adminRole.delete({ where: { id }, select: { id: true } });
  }

  countAdminsWithRole(roleId: string): Promise<number> {
    return this.prisma.admin.count({ where: { roleId } });
  }

  // Used by PermissionService to fill its cache.
  async findAllowedPages(roleId: string): Promise<string[]> {
    const rows = await this.prisma.adminPermission.findMany({
      where: { roleId, canAccess: true },
      select: { pageName: true },
    });
    return rows.map((row) => row.pageName);
  }
}

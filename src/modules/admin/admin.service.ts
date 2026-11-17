import { SUPER_ADMIN_ROLE } from "../../config/rbac.config.js";
import type { PermissionService } from "../../core/permissions/PermissionService.js";
import { ApiError } from "../../utils/ApiError.js";
import { paginated, type Paginated } from "../../utils/pagination.js";
import type { AuthenticatedAdmin } from "../admin-auth/index.js";
import type { RoleService } from "../role/index.js";
import type { SessionService } from "../session/index.js";
import type { AdminRepository } from "./admin.repository.js";
import type {
  AdminDto,
  CreateAdminBody,
  ListAdminsQuery,
  UpdateAdminBody,
} from "./admin.schema.js";

// No privilege escalation: an admin only manages admins, and only grants roles, whose pages
// they have themselves. SUPER_ADMIN accounts and the SUPER_ADMIN role are for super admins only.
export class AdminService {
  constructor(
    private readonly admins: AdminRepository,
    private readonly roles: RoleService,
    private readonly permissions: PermissionService,
    private readonly sessions: SessionService
  ) {}

  async list(query: ListAdminsQuery): Promise<Paginated<AdminDto>> {
    const { items, total } = await this.admins.list(query);
    return paginated(items, total, query);
  }

  async getById(id: string): Promise<AdminDto> {
    const admin = await this.admins.findById(id);
    if (!admin) throw ApiError.notFound("Admin not found");
    return admin;
  }

  async create(
    actor: AuthenticatedAdmin,
    input: CreateAdminBody
  ): Promise<AdminDto> {
    await this.assertCanGrantRole(actor, input.roleId);
    return this.admins.create(input);
  }

  async update(
    actor: AuthenticatedAdmin,
    id: string,
    input: UpdateAdminBody
  ): Promise<AdminDto> {
    if (id === actor.id) {
      throw ApiError.forbidden("You can't change your own admin account");
    }
    const target = await this.getById(id);
    if (!(await this.canManageRole(actor, target.role.id))) {
      throw ApiError.forbidden(
        "You can't change an admin whose role has access you don't have"
      );
    }
    if (input.roleId) await this.assertCanGrantRole(actor, input.roleId);

    const result = await this.admins.update(id, input);
    if (result === "NOT_FOUND") throw ApiError.notFound("Admin not found");
    if (result === "NO_SUPER_ADMIN_LEFT") {
      throw ApiError.conflict(
        "There must always be at least one active super admin"
      );
    }

    // A disabled admin is signed out everywhere at once (core-rules #4).
    if (input.isActive === false) {
      await this.sessions.revokeAllForOwner({ type: "ADMIN", id });
    }
    return result;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async assertCanGrantRole(
    actor: AuthenticatedAdmin,
    roleId: string
  ): Promise<void> {
    const role = await this.roles.findById(roleId);
    if (!role) throw ApiError.badRequest("Unknown role");
    if (!(await this.canManageRole(actor, role.id))) {
      throw ApiError.forbidden(
        "You can't grant a role with access you don't have"
      );
    }
  }

  private async canManageRole(
    actor: AuthenticatedAdmin,
    roleId: string
  ): Promise<boolean> {
    if (actor.role.name === SUPER_ADMIN_ROLE) return true;
    const role = await this.roles.findById(roleId);
    if (!role || role.name === SUPER_ADMIN_ROLE) return false;

    const actorPages: readonly string[] = await this.permissions.allowedPages(
      actor.role
    );
    return role.pages.every((page) => actorPages.includes(page));
  }
}

import { PAGES, SUPER_ADMIN_ROLE } from "../../../config/rbac.config.js";
import type { PermissionService } from "../../../core/permissions/PermissionService.js";
import { ApiError } from "../../../utils/ApiError.js";
import { paginated, type Paginated } from "../../../utils/pagination.js";
import type { AuthenticatedAdmin } from "../admin-auth/index.js";
import type { RoleRepository } from "./role.repository.js";
import type {
  CreateRoleBody,
  ListRolesQuery,
  RoleDto,
  UpdateRoleBody,
} from "./role.schema.js";

export class RoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly permissions: PermissionService
  ) {}

  async list(query: ListRolesQuery): Promise<Paginated<RoleDto>> {
    const { items, total } = await this.roles.list(query);
    return paginated(items, total, query);
  }

  // The page names that can be granted to a role.
  listPages(): readonly string[] {
    return PAGES;
  }

  // Null when missing. Used by the admin module when assigning a role.
  findById(id: string): Promise<RoleDto | null> {
    return this.roles.findById(id);
  }

  async getById(id: string): Promise<RoleDto> {
    const role = await this.roles.findById(id);
    if (!role) throw ApiError.notFound("Role not found");
    return role;
  }

  create(input: CreateRoleBody): Promise<RoleDto> {
    if (input.name === SUPER_ADMIN_ROLE) {
      throw ApiError.conflict("This role name is reserved");
    }
    // A duplicate name hits the unique index and becomes a 409 in errorHandler.
    return this.roles.create(input);
  }

  async update(
    id: string,
    input: UpdateRoleBody,
    actor: AuthenticatedAdmin
  ): Promise<RoleDto> {
    const role = await this.getById(id);
    this.assertCanChange(role, actor);
    if (input.name === SUPER_ADMIN_ROLE) {
      throw ApiError.conflict("This role name is reserved");
    }

    const updated = await this.roles.update(id, input);
    // Admins with this role get the new permissions on their next request.
    await this.permissions.invalidate(id);
    return updated;
  }

  async delete(id: string, actor: AuthenticatedAdmin): Promise<void> {
    const role = await this.getById(id);
    this.assertCanChange(role, actor);

    if ((await this.roles.countAdminsWithRole(id)) > 0) {
      throw ApiError.conflict(
        "This role is assigned to admins. Move them to another role first"
      );
    }
    await this.roles.delete(id);
    await this.permissions.invalidate(id);
  }

  private assertCanChange(role: RoleDto, actor: AuthenticatedAdmin): void {
    if (role.name === SUPER_ADMIN_ROLE) {
      throw ApiError.forbidden("The super admin role cannot be changed");
    }
    // Stops an admin from granting themselves more access, or locking themselves out.
    if (role.id === actor.role.id) {
      throw ApiError.forbidden("You cannot change your own role");
    }
  }
}

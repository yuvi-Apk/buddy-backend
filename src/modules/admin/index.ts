// Public entry point of the admin module: super admin panel staff accounts.
// Sign-in for those accounts lives in admin-auth.
import type { PermissionService } from "../../core/permissions/PermissionService.js";
import type { Infra, RouterDeps } from "../../types/module.types.js";
import type { RoleService } from "../role/index.js";
import type { SessionService } from "../session/index.js";
import { AdminController } from "./admin.controller.js";
import { AdminRepository } from "./admin.repository.js";
import { createAdminRouter } from "./admin.routes.js";
import { AdminService } from "./admin.service.js";

export function createAdminModule(
  { prisma }: Infra,
  deps: {
    roleService: RoleService;
    permissionService: PermissionService;
    sessionService: SessionService;
  }
) {
  const repository = new AdminRepository(prisma);
  const service = new AdminService(
    repository,
    deps.roleService,
    deps.permissionService,
    deps.sessionService
  );
  const controller = new AdminController(service);

  return {
    router: ({ guards }: RouterDeps) => createAdminRouter(controller, guards),
  };
}

export type AdminModule = ReturnType<typeof createAdminModule>;
export type { AdminDto } from "./admin.schema.js";

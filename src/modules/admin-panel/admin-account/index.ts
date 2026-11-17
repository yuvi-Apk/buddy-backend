// Public entry point of the admin module: super admin panel staff accounts.
// Sign-in for those accounts lives in admin-auth.
import type { PermissionService } from "../../../core/permissions/PermissionService.js";
import type { Infra, RouterDeps } from "../../../types/module.types.js";
import type { RoleService } from "../role/index.js";
import type { SessionService } from "../../shared/session/index.js";
import { AdminAccountController } from "./admin-account.controller.js";
import { AdminAccountRepository } from "./admin-account.repository.js";
import { createAdminAccountRouter } from "./admin-account.routes.js";
import { AdminAccountService } from "./admin-account.service.js";

export function createAdminAccountModule(
  { prisma }: Infra,
  deps: {
    roleService: RoleService;
    permissionService: PermissionService;
    sessionService: SessionService;
  }
) {
  const repository = new AdminAccountRepository(prisma);
  const service = new AdminAccountService(
    repository,
    deps.roleService,
    deps.permissionService,
    deps.sessionService
  );
  const controller = new AdminAccountController(service);

  return {
    router: ({ guards }: RouterDeps) =>
      createAdminAccountRouter(controller, guards),
  };
}

export type AdminAccountModule = ReturnType<typeof createAdminAccountModule>;
export type { AdminAccountDto } from "./admin-account.schema.js";

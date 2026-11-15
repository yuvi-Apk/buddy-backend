// Public entry point of the role module. Other code imports from here only.
import { PermissionService } from "../../core/permissions/PermissionService.js";
import type { Infra, RouterDeps } from "../../types/module.types.js";
import { RoleController } from "./role.controller.js";
import { RoleRepository } from "./role.repository.js";
import { createRoleRouter } from "./role.routes.js";
import { RoleService } from "./role.service.js";

export function createRoleModule({ prisma, redis }: Infra) {
  const repository = new RoleRepository(prisma);
  // The role module owns the role tables, so it builds the permission cache that reads them.
  const permissionService = new PermissionService(repository, redis);
  const service = new RoleService(repository, permissionService);
  const controller = new RoleController(service);

  return {
    permissionService,
    router: ({ guards }: RouterDeps) => createRoleRouter(controller, guards),
  };
}

export type RoleModule = ReturnType<typeof createRoleModule>;
export type { RoleDto } from "./role.schema.js";

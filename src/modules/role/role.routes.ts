import { Router, type RequestHandler } from "express";
import type { PageName } from "../../config/rbac.config.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { RoleController } from "./role.controller.js";
import {
  createRoleBody,
  listRolesQuery,
  roleIdParams,
  updateRoleBody,
} from "./role.schema.js";

interface Deps {
  verifyAdmin: RequestHandler;
  requirePermission: (page: PageName) => RequestHandler;
}

export function createRoleRouter(
  controller: RoleController,
  { verifyAdmin, requirePermission }: Deps
): Router {
  const router = Router();
  const canManageRoles = requirePermission("ROLE");

  router.get(
    "/",
    verifyAdmin,
    canManageRoles,
    validate({ query: listRolesQuery }),
    asyncHandler(controller.list)
  );

  // Must stay above "/:id", or "pages" would be read as an ID.
  router.get("/pages", verifyAdmin, canManageRoles, controller.listPages);

  router.get(
    "/:id",
    verifyAdmin,
    canManageRoles,
    validate({ params: roleIdParams }),
    asyncHandler(controller.getById)
  );

  router.post(
    "/",
    verifyAdmin,
    canManageRoles,
    validate({ body: createRoleBody }),
    asyncHandler(controller.create)
  );

  router.patch(
    "/:id",
    verifyAdmin,
    canManageRoles,
    validate({ params: roleIdParams, body: updateRoleBody }),
    asyncHandler(controller.update)
  );

  router.delete(
    "/:id",
    verifyAdmin,
    canManageRoles,
    validate({ params: roleIdParams }),
    asyncHandler(controller.delete)
  );

  return router;
}

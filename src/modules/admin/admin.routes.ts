import { Router, type RequestHandler } from "express";
import type { PageName } from "../../config/rbac.config.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { AdminController } from "./admin.controller.js";
import {
  adminIdParams,
  createAdminBody,
  listAdminsQuery,
  updateAdminBody,
} from "./admin.schema.js";

interface Deps {
  verifyAdmin: RequestHandler;
  requirePermission: (page: PageName) => RequestHandler;
}

// Mounted at /admin/admins.
export function createAdminRouter(
  controller: AdminController,
  { verifyAdmin, requirePermission }: Deps
): Router {
  const router = Router();
  const canManageAdmins = requirePermission("ADMIN");

  router.get(
    "/",
    verifyAdmin,
    canManageAdmins,
    validate({ query: listAdminsQuery }),
    asyncHandler(controller.list)
  );

  router.post(
    "/",
    verifyAdmin,
    canManageAdmins,
    validate({ body: createAdminBody }),
    asyncHandler(controller.create)
  );

  router.get(
    "/:id",
    verifyAdmin,
    canManageAdmins,
    validate({ params: adminIdParams }),
    asyncHandler(controller.getById)
  );

  router.patch(
    "/:id",
    verifyAdmin,
    canManageAdmins,
    validate({ params: adminIdParams, body: updateAdminBody }),
    asyncHandler(controller.update)
  );

  return router;
}

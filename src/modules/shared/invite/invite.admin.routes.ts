import { Router, type RequestHandler } from "express";
import type { PageName } from "../../../config/rbac.config.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { InviteAdminController } from "./invite.admin.controller.js";
import {
  adminInviteParams,
  adminOrganizationParams,
  createInviteBody,
  listInvitesQuery,
} from "./invite.schema.js";

interface AdminDeps {
  verifyAdmin: RequestHandler;
  requirePermission: (page: PageName) => RequestHandler;
}

// Mounted at /admin/organizations/:organizationId/invites.
export function createInviteAdminRouter(
  controller: InviteAdminController,
  { verifyAdmin, requirePermission }: AdminDeps
): Router {
  const router = Router({ mergeParams: true });
  const canManageOrganizations = requirePermission("ORGANIZATION");

  router.get(
    "/",
    verifyAdmin,
    canManageOrganizations,
    validate({ params: adminOrganizationParams, query: listInvitesQuery }),
    asyncHandler(controller.list)
  );

  router.post(
    "/",
    verifyAdmin,
    canManageOrganizations,
    validate({ params: adminOrganizationParams, body: createInviteBody }),
    asyncHandler(controller.create)
  );

  router.delete(
    "/:inviteId",
    verifyAdmin,
    canManageOrganizations,
    validate({ params: adminInviteParams }),
    asyncHandler(controller.revoke)
  );

  return router;
}

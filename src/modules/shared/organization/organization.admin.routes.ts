import { Router, type RequestHandler } from "express";
import type { PageName } from "../../../config/rbac.config.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { OrganizationAdminController } from "./organization.admin.controller.js";
import {
  addOrganizationAdminBody,
  createOrganizationBody,
  listMembersQuery,
  listOrganizationsQuery,
  organizationIdParams,
  updateMembershipSettingsBody,
  updateOrganizationBody,
  userIdParams,
} from "./organization.schema.js";

interface AdminDeps {
  verifyAdmin: RequestHandler;
  requirePermission: (page: PageName) => RequestHandler;
}

// Mounted at /admin/organizations.
export function createOrganizationAdminRouter(
  controller: OrganizationAdminController,
  { verifyAdmin, requirePermission }: AdminDeps
): Router {
  const router = Router();
  const canManageOrganizations = requirePermission("ORGANIZATION");

  router.get(
    "/",
    verifyAdmin,
    canManageOrganizations,
    validate({ query: listOrganizationsQuery }),
    asyncHandler(controller.list)
  );

  router.post(
    "/",
    verifyAdmin,
    canManageOrganizations,
    validate({ body: createOrganizationBody }),
    asyncHandler(controller.create)
  );

  router.get(
    "/:id",
    verifyAdmin,
    canManageOrganizations,
    validate({ params: organizationIdParams }),
    asyncHandler(controller.getById)
  );

  router.patch(
    "/:id",
    verifyAdmin,
    canManageOrganizations,
    validate({ params: organizationIdParams, body: updateOrganizationBody }),
    asyncHandler(controller.update)
  );

  router.post(
    "/:id/join-code/regenerate",
    verifyAdmin,
    canManageOrganizations,
    validate({ params: organizationIdParams }),
    asyncHandler(controller.regenerateJoinCode)
  );

  router.get(
    "/:id/members",
    verifyAdmin,
    canManageOrganizations,
    validate({ params: organizationIdParams, query: listMembersQuery }),
    asyncHandler(controller.listMembers)
  );

  router.post(
    "/:id/admins",
    verifyAdmin,
    canManageOrganizations,
    validate({ params: organizationIdParams, body: addOrganizationAdminBody }),
    asyncHandler(controller.addOrganizationAdmin)
  );

  return router;
}

// Mounted at /admin/users: per-user settings that the join rule reads.
export function createMembershipSettingsAdminRouter(
  controller: OrganizationAdminController,
  { verifyAdmin, requirePermission }: AdminDeps
): Router {
  const router = Router();

  router.patch(
    "/:userId/membership-settings",
    verifyAdmin,
    requirePermission("ORGANIZATION"),
    validate({ params: userIdParams, body: updateMembershipSettingsBody }),
    asyncHandler(controller.updateMembershipSettings)
  );

  return router;
}

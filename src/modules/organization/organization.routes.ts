import { Router, type RequestHandler } from "express";
import type { PageName } from "../../config/rbac.config.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { OrganizationController } from "./organization.controller.js";
import {
  addOrganizationAdminBody,
  createOrganizationBody,
  listMembersQuery,
  listMyOrganizationsQuery,
  listOrganizationsQuery,
  organizationIdParams,
  updateJoinCodeBody,
  updateMembershipSettingsBody,
  updateOrganizationBody,
  userIdParams,
  type MembershipRole,
} from "./organization.schema.js";

interface AdminDeps {
  verifyAdmin: RequestHandler;
  requirePermission: (page: PageName) => RequestHandler;
}

interface UserDeps {
  verifyUser: RequestHandler;
  requireOrganizationRole: (...roles: MembershipRole[]) => RequestHandler;
}

// Mounted at /admin/organizations.
export function createOrganizationAdminRouter(
  controller: OrganizationController,
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
  controller: OrganizationController,
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

// Mounted at /user/organizations. "/current" routes act on the organization named in
// the X-Organization-Id header.
export function createOrganizationUserRouter(
  controller: OrganizationController,
  { verifyUser, requireOrganizationRole }: UserDeps
): Router {
  const router = Router();
  const anyMember = requireOrganizationRole();
  const organizationAdmin = requireOrganizationRole("ORGANIZATION_ADMIN");

  router.get(
    "/",
    verifyUser,
    validate({ query: listMyOrganizationsQuery }),
    asyncHandler(controller.listMine)
  );

  router.get(
    "/current",
    verifyUser,
    anyMember,
    asyncHandler(controller.getCurrent)
  );

  router.get(
    "/current/join-code",
    verifyUser,
    organizationAdmin,
    asyncHandler(controller.getJoinCode)
  );

  router.patch(
    "/current/join-code",
    verifyUser,
    organizationAdmin,
    validate({ body: updateJoinCodeBody }),
    asyncHandler(controller.updateJoinCode)
  );

  router.post(
    "/current/join-code/regenerate",
    verifyUser,
    organizationAdmin,
    asyncHandler(controller.regenerateOwnJoinCode)
  );

  return router;
}

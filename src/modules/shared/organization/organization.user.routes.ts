import { Router, type RequestHandler } from "express";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { OrganizationUserController } from "./organization.user.controller.js";
import {
  listMembersQuery,
  listMyOrganizationsQuery,
  membershipIdParams,
  updateJoinCodeBody,
  updateMemberBody,
  type MembershipRole,
} from "./organization.schema.js";

interface UserDeps {
  verifyUser: RequestHandler;
  requireOrganizationRole: (...roles: MembershipRole[]) => RequestHandler;
}

// Mounted at /user/organizations. "/current" routes act on the organization named in
// the X-Organization-Id header.
export function createOrganizationUserRouter(
  controller: OrganizationUserController,
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

  router.get(
    "/current/members",
    verifyUser,
    organizationAdmin,
    validate({ query: listMembersQuery }),
    asyncHandler(controller.listCurrentMembers)
  );

  router.patch(
    "/current/members/:membershipId",
    verifyUser,
    organizationAdmin,
    validate({ params: membershipIdParams, body: updateMemberBody }),
    asyncHandler(controller.updateMember)
  );

  router.delete(
    "/current/members/:membershipId",
    verifyUser,
    organizationAdmin,
    validate({ params: membershipIdParams }),
    asyncHandler(controller.removeMember)
  );

  router.post(
    "/current/leave",
    verifyUser,
    anyMember,
    asyncHandler(controller.leave)
  );

  return router;
}

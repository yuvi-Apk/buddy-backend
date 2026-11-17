import { Router, type RequestHandler } from "express";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { MembershipRole } from "../organization/index.js";
import type { InviteUserController } from "./invite.user.controller.js";
import {
  acceptInviteBody,
  acceptInviteByTokenBody,
  createInviteBody,
  inviteIdParams,
  listInvitesQuery,
  listReceivedInvitesQuery,
} from "./invite.schema.js";

interface UserDeps {
  verifyUser: RequestHandler;
  requireOrganizationRole: (...roles: MembershipRole[]) => RequestHandler;
}

// Mounted at /user/invites.
export function createInviteUserRouter(
  controller: InviteUserController,
  { verifyUser, requireOrganizationRole }: UserDeps
): Router {
  const router = Router();
  const organizationAdmin = requireOrganizationRole("ORGANIZATION_ADMIN");

  // --- the invited person (no X-Organization-Id: they aren't a member yet) ---

  router.get(
    "/received",
    verifyUser,
    validate({ query: listReceivedInvitesQuery }),
    asyncHandler(controller.listReceived)
  );

  router.post(
    "/accept",
    verifyUser,
    validate({ body: acceptInviteByTokenBody }),
    asyncHandler(controller.acceptByToken)
  );

  router.post(
    "/received/:id/accept",
    verifyUser,
    validate({ params: inviteIdParams, body: acceptInviteBody }),
    asyncHandler(controller.acceptById)
  );

  // --- organization admins, inside the X-Organization-Id organization ---

  router.get(
    "/",
    verifyUser,
    organizationAdmin,
    validate({ query: listInvitesQuery }),
    asyncHandler(controller.list)
  );

  router.post(
    "/",
    verifyUser,
    organizationAdmin,
    validate({ body: createInviteBody }),
    asyncHandler(controller.create)
  );

  router.delete(
    "/:id",
    verifyUser,
    organizationAdmin,
    validate({ params: inviteIdParams }),
    asyncHandler(controller.revoke)
  );

  return router;
}

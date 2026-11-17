import { Router, type RequestHandler } from "express";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { MembershipRole } from "../../shared/organization/index.js";
import type { JoinRequestController } from "./join-request.controller.js";
import {
  approveJoinRequestBody,
  createJoinRequestBody,
  joinRequestIdParams,
  listJoinRequestsQuery,
  rejectJoinRequestBody,
} from "./join-request.schema.js";

interface Deps {
  verifyUser: RequestHandler;
  requireOrganizationRole: (...roles: MembershipRole[]) => RequestHandler;
  joinCodeRateLimit: RequestHandler;
}

// Mounted at /user/join-requests.
export function createJoinRequestRouter(
  controller: JoinRequestController,
  { verifyUser, requireOrganizationRole, joinCodeRateLimit }: Deps
): Router {
  const router = Router();
  const organizationAdmin = requireOrganizationRole("ORGANIZATION_ADMIN");

  // --- the person asking (no X-Organization-Id: they aren't a member yet) ---

  router.post(
    "/",
    verifyUser,
    joinCodeRateLimit,
    validate({ body: createJoinRequestBody }),
    asyncHandler(controller.create)
  );

  router.get(
    "/mine",
    verifyUser,
    validate({ query: listJoinRequestsQuery }),
    asyncHandler(controller.listMine)
  );

  router.post(
    "/mine/:id/cancel",
    verifyUser,
    validate({ params: joinRequestIdParams }),
    asyncHandler(controller.cancel)
  );

  // --- organization admins, inside the X-Organization-Id organization ---

  router.get(
    "/",
    verifyUser,
    organizationAdmin,
    validate({ query: listJoinRequestsQuery }),
    asyncHandler(controller.listForReview)
  );

  router.post(
    "/:id/approve",
    verifyUser,
    organizationAdmin,
    validate({ params: joinRequestIdParams, body: approveJoinRequestBody }),
    asyncHandler(controller.approve)
  );

  router.post(
    "/:id/reject",
    verifyUser,
    organizationAdmin,
    validate({ params: joinRequestIdParams, body: rejectJoinRequestBody }),
    asyncHandler(controller.reject)
  );

  return router;
}

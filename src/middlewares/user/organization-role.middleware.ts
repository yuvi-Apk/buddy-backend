// Guard for app routes that act inside one organization. Runs after verifyUser.
//
//   router.get("/current", verifyUser, requireOrganizationRole(), controller.getCurrent);
//   router.post("/x", verifyUser, requireOrganizationRole("ORGANIZATION_ADMIN"), ...);
//
// The app names the organization in the X-Organization-Id header. The caller needs an
// ACTIVE membership in an active organization, with one of the roles (none = any role).
// Not a member answers 404, so outsiders can't probe which organizations exist (core-rules #8).
// No cache: the lookup is one unique-index query, and nothing can go stale.
import type { RequestHandler } from "express";
import { z } from "zod";
import {
  ORGANIZATION_ID_HEADER,
  type MembershipRole,
  type OrganizationService,
} from "../../modules/shared/organization/index.js";
import { ApiError } from "../../utils/ApiError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { markGuard } from "../routeGuard.js";

const organizationIdHeader = z.uuid();

export function createRequireOrganizationRole(
  organizationService: OrganizationService
) {
  return (...allowedRoles: MembershipRole[]): RequestHandler =>
    markGuard(
      asyncHandler(async (req, _res, next) => {
        if (!req.user) throw ApiError.unauthorized();

        const header = organizationIdHeader.safeParse(
          req.get(ORGANIZATION_ID_HEADER)
        );
        if (!header.success) {
          throw ApiError.badRequest(
            "Send the organization's id in the X-Organization-Id header"
          );
        }

        req.membership = await organizationService.getMembershipForRequest(
          header.data,
          req.user.id,
          allowedRoles
        );
        next();
      }),
      "organization-role"
    );
}

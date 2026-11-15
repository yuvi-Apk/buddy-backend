// Guards for admin panel routes.
//
//   router.get("/roles", verifyAdmin, requirePermission("ROLE"), controller.list);
//
// verifyAdmin answers "who is calling?". It checks, on every request:
//   1. the access token is genuine, unexpired and an ADMIN token
//   2. the session behind it is still active (so logout works immediately, core-rules #4)
//   3. the admin account still exists and is enabled
import type { Request, RequestHandler } from "express";
import type { PageName } from "../../config/rbac.config.js";
import type { PermissionService } from "../../core/permissions/PermissionService.js";
import type { TokenService } from "../../core/security/TokenService.js";
import type { AdminAuthService } from "../../modules/admin-auth/index.js";
import type { SessionService } from "../../modules/session/index.js";
import { ApiError } from "../../utils/ApiError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { bearerToken } from "../../utils/clientInfo.js";
import { markGuard } from "../routeGuard.js";

interface Deps {
  tokenService: TokenService;
  sessionService: SessionService;
  adminAuthService: AdminAuthService;
}

// The admin panel sends the token as a cookie; other clients use the Authorization header.
function accessTokenFrom(req: Request): string | undefined {
  const cookie = (req.cookies as Record<string, unknown> | undefined)
    ?.accessToken;
  return typeof cookie === "string" && cookie ? cookie : bearerToken(req);
}

export function createVerifyAdmin({
  tokenService,
  sessionService,
  adminAuthService,
}: Deps): RequestHandler {
  const verifyAdmin = asyncHandler(async (req, _res, next) => {
    const token = accessTokenFrom(req);
    if (!token) throw ApiError.unauthorized();

    const { adminUserId, sessionId } =
      tokenService.verifyAdminAccessToken(token);
    const subject = { type: "ADMIN", id: adminUserId } as const;

    if (!(await sessionService.isActive(sessionId, subject))) {
      throw ApiError.unauthorized();
    }

    const adminUser = await adminAuthService.getAuthenticatedAdmin(adminUserId);
    if (!adminUser) throw ApiError.unauthorized();

    req.adminUser = adminUser;
    req.auth = { subject, sessionId };
    next();
  });

  return markGuard(verifyAdmin, "admin");
}

// requirePermission answers "may this admin use this page?". It must come after verifyAdmin.
// SUPER_ADMIN passes every check. Pages are defined in src/config/rbac.config.ts.
export function createPermissionGuards(permissionService: PermissionService) {
  /** The admin's role must have access to this page. */
  const requirePermission = (page: PageName): RequestHandler =>
    markGuard(
      asyncHandler(async (req, _res, next) => {
        if (!req.adminUser) throw ApiError.unauthorized();

        const allowed = await permissionService.hasAccess(
          req.adminUser.role,
          page
        );
        if (!allowed) throw ApiError.forbidden("Forbidden: No permission");
        next();
      }),
      "permission"
    );

  /** The admin's role must have access to at least one of these pages. */
  const requireAnyPermission = (pages: PageName[]): RequestHandler =>
    markGuard(
      asyncHandler(async (req, _res, next) => {
        if (!req.adminUser) throw ApiError.unauthorized();

        const allowed = await permissionService.hasAnyAccess(
          req.adminUser.role,
          pages
        );
        if (!allowed) throw ApiError.forbidden("Forbidden: No permission");
        next();
      }),
      "permission"
    );

  return { requirePermission, requireAnyPermission };
}

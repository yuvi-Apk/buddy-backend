// Guard for app (student) routes.
//
//   router.get("/me", verifyUser, controller.me);
//
// Same three checks as verifyAdmin, with USER tokens: genuine token, active session,
// enabled account. The app sends the token in the Authorization header.
import type { RequestHandler } from "express";
import type { TokenService } from "../../core/security/TokenService.js";
import type { SessionService } from "../../modules/session/index.js";
import type { UserAuthService } from "../../modules/user-auth/index.js";
import { ApiError } from "../../utils/ApiError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { bearerToken } from "../../utils/clientInfo.js";
import { markGuard } from "../routeGuard.js";

interface Deps {
  tokenService: TokenService;
  sessionService: SessionService;
  userAuthService: UserAuthService;
}

export function createVerifyUser({
  tokenService,
  sessionService,
  userAuthService,
}: Deps): RequestHandler {
  const verifyUser = asyncHandler(async (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) throw ApiError.unauthorized();

    const { userId, sessionId } = tokenService.verifyUserAccessToken(token);
    const subject = { type: "USER", id: userId } as const;

    if (!(await sessionService.isActive(sessionId, subject))) {
      throw ApiError.unauthorized();
    }

    const user = await userAuthService.getAuthenticatedUser(userId);
    if (!user) throw ApiError.unauthorized();

    req.user = user;
    req.auth = { subject, sessionId };
    next();
  });

  return markGuard(verifyUser, "user");
}

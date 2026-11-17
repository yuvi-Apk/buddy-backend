import { Router, type RequestHandler } from "express";
import { publicRoute } from "../../../middlewares/routeGuard.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { UserAuthController } from "./user-auth.controller.js";
import { userGoogleSignInBody, userRefreshBody } from "./user-auth.schema.js";

interface Deps {
  verifyUser: RequestHandler;
  authRateLimit: RequestHandler;
}

export function createUserAuthRouter(
  controller: UserAuthController,
  { verifyUser, authRateLimit }: Deps
): Router {
  const router = Router();

  router.post(
    "/google",
    publicRoute(),
    authRateLimit,
    validate({ body: userGoogleSignInBody }),
    asyncHandler(controller.signInWithGoogle)
  );

  router.post(
    "/refresh",
    publicRoute(),
    authRateLimit,
    validate({ body: userRefreshBody }),
    asyncHandler(controller.refresh)
  );

  router.post("/logout", verifyUser, asyncHandler(controller.logout));

  router.post(
    "/logout-all",
    verifyUser,
    asyncHandler(controller.logoutAllDevices)
  );

  router.get("/me", verifyUser, controller.me);

  return router;
}

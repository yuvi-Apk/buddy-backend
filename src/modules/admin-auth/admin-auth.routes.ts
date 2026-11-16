import { Router, type RequestHandler } from "express";
import { publicRoute } from "../../middlewares/routeGuard.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { AdminAuthController } from "./admin-auth.controller.js";
import {
  adminGoogleSignInBody,
  adminRefreshBody,
} from "./admin-auth.schema.js";

interface Deps {
  verifyAdmin: RequestHandler;
  ownAccountRoute: () => RequestHandler;
  authRateLimit: RequestHandler;
}

export function createAdminAuthRouter(
  controller: AdminAuthController,
  { verifyAdmin, ownAccountRoute, authRateLimit }: Deps
): Router {
  const router = Router();

  router.post(
    "/google",
    publicRoute(),
    authRateLimit,
    validate({ body: adminGoogleSignInBody }),
    asyncHandler(controller.signInWithGoogle)
  );

  router.post(
    "/refresh",
    publicRoute(),
    authRateLimit,
    validate({ body: adminRefreshBody }),
    asyncHandler(controller.refresh)
  );

  router.post(
    "/logout",
    verifyAdmin,
    ownAccountRoute(),
    asyncHandler(controller.logout)
  );

  router.get(
    "/me",
    verifyAdmin,
    ownAccountRoute(),
    asyncHandler(controller.me)
  );

  return router;
}

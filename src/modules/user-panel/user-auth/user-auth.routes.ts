import { Router, type RequestHandler } from "express";
import { publicRoute } from "../../../middlewares/routeGuard.js";
import { uploadSingleImage } from "../../../middlewares/upload.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { UserAuthController } from "./user-auth.controller.js";
import {
  updateUserProfileBody,
  userGoogleSignInBody,
  userRefreshBody,
} from "./user-auth.schema.js";

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

  // The guard runs before multer, so nothing is written to disk without a valid login.
  router.put(
    "/me/avatar",
    verifyUser,
    uploadSingleImage("image"),
    asyncHandler(controller.updateAvatar)
  );

  router.delete(
    "/me/avatar",
    verifyUser,
    asyncHandler(controller.removeAvatar)
  );

  router.get("/me", verifyUser, controller.me);

  router.patch(
    "/me",
    verifyUser,
    validate({ body: updateUserProfileBody }),
    asyncHandler(controller.updateProfile)
  );

  return router;
}

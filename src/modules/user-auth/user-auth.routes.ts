import { Router, type RequestHandler } from "express";
import { publicRoute } from "../../middlewares/routeGuard.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { UserAuthController } from "./user-auth.controller.js";
import {
  requestOtpBody,
  userRefreshBody,
  verifyOtpBody,
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
    "/otp/request",
    publicRoute(),
    authRateLimit,
    validate({ body: requestOtpBody }),
    asyncHandler(controller.requestOtp)
  );

  router.post(
    "/otp/verify",
    publicRoute(),
    authRateLimit,
    validate({ body: verifyOtpBody }),
    asyncHandler(controller.verifyOtp)
  );

  router.post(
    "/refresh",
    publicRoute(),
    authRateLimit,
    validate({ body: userRefreshBody }),
    asyncHandler(controller.refresh)
  );

  router.post("/logout", verifyUser, asyncHandler(controller.logout));

  router.get("/me", verifyUser, controller.me);

  return router;
}

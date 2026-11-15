// Session routes are the same for admins and app users, so the router is built twice:
// once behind verifyAdmin (/admin/sessions) and once behind verifyUser (/user/sessions).
// Both only ever touch the caller's own sessions.
import { Router, type RequestHandler } from "express";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { SessionController } from "./session.controller.js";
import { sessionIdParams } from "./session.schema.js";

export function createSessionRouter(
  controller: SessionController,
  /** The guards for this mount, e.g. [verifyAdmin, ownAccountRoute()] or [verifyUser]. */
  guards: RequestHandler[]
): Router {
  const router = Router();

  router.get("/", ...guards, asyncHandler(controller.list));

  router.delete(
    "/:id",
    ...guards,
    validate({ params: sessionIdParams }),
    asyncHandler(controller.revoke)
  );

  return router;
}

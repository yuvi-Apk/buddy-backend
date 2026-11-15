// Mounts every module under /api/v1. Add one line here per new module.
import { Router } from "express";
import type { Container } from "./container.js";
import { createHealthRouter } from "./core/health/health.routes.js";
import { ownAccountRoute } from "./middlewares/routeGuard.js";
import { createAdminAuthRouter } from "./modules/admin-auth/admin-auth.routes.js";
import { createSessionRouter } from "./modules/session/session.routes.js";

export function createApiRouter(container: Container): Router {
  const router = Router();
  const { guards, rateLimiters } = container;

  // Health checks come before the rate limiter so load balancers are never throttled.
  router.use("/health", createHealthRouter(container.healthChecks));

  router.use(rateLimiters.global);

  // --- admin panel ---
  router.use(
    "/admin/auth",
    createAdminAuthRouter(container.adminAuthController, {
      verifyAdmin: guards.verifyAdmin,
      ownAccountRoute,
      authRateLimit: rateLimiters.auth,
    })
  );
  router.use(
    "/admin/sessions",
    createSessionRouter(container.sessionController, [
      guards.verifyAdmin,
      ownAccountRoute(),
    ])
  );

  return router;
}

// Mounts every module under /api/v1. Add one line here per new module.
import { Router } from "express";
import type { Container } from "./container.js";
import { createHealthRouter } from "./core/health/health.routes.js";
import type { RouterDeps } from "./types/module.types.js";

export function createApiRouter(container: Container): Router {
  const router = Router();
  const { modules } = container;
  const deps: RouterDeps = {
    guards: container.guards,
    rateLimiters: container.rateLimiters,
  };

  // Health checks come before the rate limiter so load balancers are never throttled.
  router.use("/health", createHealthRouter(container.healthChecks));
  router.use(deps.rateLimiters.global);

  // --- admin panel ---
  router.use("/admin/auth", modules.adminAuth.router(deps));
  router.use("/admin/sessions", modules.session.adminRouter(deps));
  router.use("/admin/roles", modules.role.router(deps));
  router.use("/admin/uploads", modules.upload.router(deps));
  router.use("/admin/organizations", modules.organization.adminRouter(deps));
  router.use(
    "/admin/organizations/:organizationId/invites",
    modules.invite.adminRouter(deps)
  );
  router.use(
    "/admin/users",
    modules.organization.membershipSettingsAdminRouter(deps)
  );

  // --- mobile app ---
  router.use("/user/auth", modules.userAuth.router(deps));
  router.use("/user/sessions", modules.session.userRouter(deps));
  router.use("/user/organizations", modules.organization.userRouter(deps));
  router.use("/user/classrooms", modules.classroom.router(deps));
  router.use("/user/invites", modules.invite.userRouter(deps));

  return router;
}

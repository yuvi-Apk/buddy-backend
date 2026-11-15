// Mounts every module under /api/v1. Add one line here per new module.
import { Router } from "express";
import type { Container } from "./container.js";
import { createHealthRouter } from "./core/health/health.routes.js";

export function createApiRouter(container: Container): Router {
  const router = Router();

  // Health checks come before the rate limiter so load balancers are never throttled.
  router.use("/health", createHealthRouter(container.healthChecks));

  router.use(container.rateLimiters.global);

  return router;
}

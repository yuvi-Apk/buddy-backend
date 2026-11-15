// Mounts every module under /api/v1. Add one line here per new module.
import { Router } from "express";
import type { Container } from "./container.js";
import { createHealthRouter } from "./core/health/health.routes.js";

export function createApiRouter(container: Container): Router {
  const router = Router();

  router.use("/health", createHealthRouter(container.healthChecks));

  return router;
}

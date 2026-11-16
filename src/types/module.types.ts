// Types shared by every module's index.ts, container.ts and routes.ts.
// Kept here (not in container.ts) so a module never imports the container.
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import type { PageName } from "../config/rbac.config.js";
import type { Redis } from "../config/redis.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { RateLimiters } from "../middlewares/rateLimit.middleware.js";

// Connections every module may need. Created once in container.ts.
export interface Infra {
  prisma: PrismaClient;
  redis: Redis;
  logger: Logger;
}

// The auth guards, built in container.ts once the auth modules exist.
export interface Guards {
  // Requires a logged-in admin. Sets req.adminUser and req.auth.
  verifyAdmin: RequestHandler;
  // Requires a logged-in app user. Sets req.user and req.auth.
  verifyUser: RequestHandler;
  // After verifyAdmin: the admin's role must have access to this page.
  requirePermission: (page: PageName) => RequestHandler;
  // After verifyAdmin: the admin's role must have access to at least one of these pages.
  requireAnyPermission: (pages: PageName[]) => RequestHandler;
}

// What a module's router(...) function receives in routes.ts.
export interface RouterDeps {
  guards: Guards;
  rateLimiters: RateLimiters;
}

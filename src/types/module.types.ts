// Types shared by every module's index.ts, container.ts and routes.ts.
// Kept here (not in container.ts) so a module never imports the container.
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import type { PageName } from "../config/rbac.config.js";
import type { Redis } from "../config/redis.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { RateLimiters } from "../middlewares/rateLimit.middleware.js";
import type { MembershipRole } from "../modules/organization/index.js";

// Connections every module may need. Created once in container.ts.
export interface Infra {
  prisma: PrismaClient;
  redis: Redis;
  logger: Logger;
}

// The auth guards, built in container.ts once the auth modules exist.
export interface Guards {
  // Requires a logged-in admin. Sets req.admin and req.auth.
  verifyAdmin: RequestHandler;
  // Requires a logged-in app user. Sets req.user and req.auth.
  verifyUser: RequestHandler;
  // After verifyAdmin: the admin's role must have access to this page.
  requirePermission: (page: PageName) => RequestHandler;
  // After verifyAdmin: the admin's role must have access to at least one of these pages.
  requireAnyPermission: (pages: PageName[]) => RequestHandler;
  // After verifyUser: an ACTIVE membership in the X-Organization-Id organization, with one
  // of these roles (none = any role). Sets req.membership.
  requireOrganizationRole: (...roles: MembershipRole[]) => RequestHandler;
}

// What a module's router(...) function receives in routes.ts.
export interface RouterDeps {
  guards: Guards;
  rateLimiters: RateLimiters;
}

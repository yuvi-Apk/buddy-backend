// Public entry point of the admin-auth module. Other code imports from here only.
import { env } from "../../config/env.js";
import type { PermissionService } from "../../core/permissions/PermissionService.js";
import type { PasswordHasher } from "../../core/security/PasswordHasher.js";
import type { TokenService } from "../../core/security/TokenService.js";
import { ownAccountRoute } from "../../middlewares/routeGuard.js";
import type { Infra, RouterDeps } from "../../types/module.types.js";
import type { SessionService } from "../session/index.js";
import { AdminAuthController } from "./admin-auth.controller.js";
import { AdminAuthRepository } from "./admin-auth.repository.js";
import { createAdminAuthRouter } from "./admin-auth.routes.js";
import { AdminAuthService } from "./admin-auth.service.js";

export function createAdminAuthModule(
  { prisma, logger }: Infra,
  deps: {
    sessionService: SessionService;
    tokenService: TokenService;
    passwordHasher: PasswordHasher;
    permissionService: PermissionService;
  }
) {
  const repository = new AdminAuthRepository(prisma);
  const service = new AdminAuthService(
    repository,
    deps.sessionService,
    deps.tokenService,
    deps.passwordHasher,
    deps.permissionService,
    logger
  );
  const controller = new AdminAuthController(service, {
    secure: env.NODE_ENV === "production",
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
  });

  return {
    service,
    router: ({ guards, rateLimiters }: RouterDeps) =>
      createAdminAuthRouter(controller, {
        verifyAdmin: guards.verifyAdmin,
        ownAccountRoute,
        authRateLimit: rateLimiters.auth,
      }),
  };
}

export type AdminAuthModule = ReturnType<typeof createAdminAuthModule>;
export type { AdminAuthService } from "./admin-auth.service.js";
export type { AuthenticatedAdmin } from "./admin-auth.schema.js";

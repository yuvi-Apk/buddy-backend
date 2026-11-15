// Composition root: the only file that constructs classes and wires them together.
// Order inside createContainer: infrastructure → repositories → services → guards → controllers.
import type { RequestHandler } from "express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import type { HealthCheck } from "./core/health/health.routes.js";
import { PasswordHasher } from "./core/security/PasswordHasher.js";
import { TokenService } from "./core/security/TokenService.js";
import { createVerifyAdmin } from "./middlewares/admin/auth.middleware.js";
import {
  createRateLimiters,
  type RateLimiters,
} from "./middlewares/rateLimit.middleware.js";
import { AdminAuthController } from "./modules/admin-auth/admin-auth.controller.js";
import { AdminAuthRepository } from "./modules/admin-auth/admin-auth.repository.js";
import { AdminAuthService } from "./modules/admin-auth/admin-auth.service.js";
import { SessionController } from "./modules/session/session.controller.js";
import { SessionRepository } from "./modules/session/session.repository.js";
import { SessionService } from "./modules/session/session.service.js";

export interface Guards {
  /** Requires a logged-in admin. Sets req.adminUser and req.auth. */
  verifyAdmin: RequestHandler;
}

export interface Container {
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  rateLimiters: RateLimiters;
  guards: Guards;

  sessionService: SessionService;
  sessionController: SessionController;
  adminAuthController: AdminAuthController;

  healthChecks: Record<string, HealthCheck>;
  /** Closes database and cache connections. Called on shutdown and after tests. */
  shutdown: () => Promise<void>;
}

export function createContainer(): Container {
  // --- infrastructure ---
  const passwordHasher = new PasswordHasher();
  const tokenService = new TokenService({
    adminSecret: env.ADMIN_ACCESS_TOKEN_SECRET,
    userSecret: env.USER_ACCESS_TOKEN_SECRET,
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
  });
  const rateLimiters = createRateLimiters(redis);

  // --- session ---
  const sessionRepository = new SessionRepository(prisma);
  const sessionService = new SessionService(
    sessionRepository,
    tokenService,
    redis,
    logger,
    { refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS }
  );
  const sessionController = new SessionController(sessionService);

  // --- admin auth ---
  const adminAuthRepository = new AdminAuthRepository(prisma);
  const adminAuthService = new AdminAuthService(
    adminAuthRepository,
    sessionService,
    tokenService,
    passwordHasher,
    logger
  );
  const adminAuthController = new AdminAuthController(adminAuthService, {
    secure: env.NODE_ENV === "production",
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
  });

  // --- guards ---
  const guards: Guards = {
    verifyAdmin: createVerifyAdmin({
      tokenService,
      sessionService,
      adminAuthService,
    }),
  };

  return {
    passwordHasher,
    tokenService,
    rateLimiters,
    guards,

    sessionService,
    sessionController,
    adminAuthController,

    healthChecks: {
      postgres: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      redis: async () => {
        await redis.ping();
      },
    },

    shutdown: async () => {
      await prisma.$disconnect();
      await redis.quit();
    },
  };
}

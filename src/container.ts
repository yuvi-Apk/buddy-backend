// Composition root: the only file that constructs classes and wires them together.
// Order inside createContainer: infrastructure → repositories → services → guards → controllers.
import type { RequestHandler } from "express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import type { HealthCheck } from "./core/health/health.routes.js";
import { LogOtpSender, type OtpSender } from "./core/otp/OtpSender.js";
import { OtpService } from "./core/otp/OtpService.js";
import { PasswordHasher } from "./core/security/PasswordHasher.js";
import { TokenService } from "./core/security/TokenService.js";
import { createVerifyAdmin } from "./middlewares/admin/auth.middleware.js";
import {
  createRateLimiters,
  type RateLimiters,
} from "./middlewares/rateLimit.middleware.js";
import { createVerifyUser } from "./middlewares/user/auth.middleware.js";
import { AdminAuthController } from "./modules/admin-auth/admin-auth.controller.js";
import { AdminAuthRepository } from "./modules/admin-auth/admin-auth.repository.js";
import { AdminAuthService } from "./modules/admin-auth/admin-auth.service.js";
import { SessionController } from "./modules/session/session.controller.js";
import { SessionRepository } from "./modules/session/session.repository.js";
import { SessionService } from "./modules/session/session.service.js";
import { UserAuthController } from "./modules/user-auth/user-auth.controller.js";
import { UserAuthRepository } from "./modules/user-auth/user-auth.repository.js";
import { UserAuthService } from "./modules/user-auth/user-auth.service.js";

export interface Guards {
  /** Requires a logged-in admin. Sets req.adminUser and req.auth. */
  verifyAdmin: RequestHandler;
  /** Requires a logged-in app user. Sets req.user and req.auth. */
  verifyUser: RequestHandler;
}

export interface Container {
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  rateLimiters: RateLimiters;
  guards: Guards;

  sessionService: SessionService;
  sessionController: SessionController;
  adminAuthController: AdminAuthController;
  userAuthController: UserAuthController;

  healthChecks: Record<string, HealthCheck>;
  /** Closes database and cache connections. Called on shutdown and after tests. */
  shutdown: () => Promise<void>;
}

/** Parts that tests (or a different deployment) may swap for their own implementation. */
export interface ContainerOverrides {
  otpSender?: OtpSender;
}

export function createContainer(overrides: ContainerOverrides = {}): Container {
  // --- infrastructure ---
  const passwordHasher = new PasswordHasher();
  const tokenService = new TokenService({
    adminSecret: env.ADMIN_ACCESS_TOKEN_SECRET,
    userSecret: env.USER_ACCESS_TOKEN_SECRET,
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
  });
  const rateLimiters = createRateLimiters(redis);
  const otpService = new OtpService(redis, env.OTP_HMAC_SECRET);
  // OTP_SENDER has one value today ("log"). Add a case here with each new SMS provider.
  const otpSender = overrides.otpSender ?? new LogOtpSender(logger);

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

  // --- user auth ---
  const userAuthRepository = new UserAuthRepository(prisma);
  const userAuthService = new UserAuthService(
    userAuthRepository,
    sessionService,
    tokenService,
    otpService,
    otpSender
  );
  const userAuthController = new UserAuthController(userAuthService);

  // --- guards ---
  const guards: Guards = {
    verifyAdmin: createVerifyAdmin({
      tokenService,
      sessionService,
      adminAuthService,
    }),
    verifyUser: createVerifyUser({
      tokenService,
      sessionService,
      userAuthService,
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
    userAuthController,

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

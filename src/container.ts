// Composition root: the only file that constructs classes and wires them together.
// Order inside createContainer: infrastructure → repositories → services → controllers.
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import type { HealthCheck } from "./core/health/health.routes.js";
import { PasswordHasher } from "./core/security/PasswordHasher.js";
import { TokenService } from "./core/security/TokenService.js";
import {
  createRateLimiters,
  type RateLimiters,
} from "./middlewares/rateLimit.middleware.js";
import { SessionController } from "./modules/session/session.controller.js";
import { SessionRepository } from "./modules/session/session.repository.js";
import { SessionService } from "./modules/session/session.service.js";

export interface Container {
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  rateLimiters: RateLimiters;

  sessionService: SessionService;
  sessionController: SessionController;

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

  return {
    passwordHasher,
    tokenService,
    rateLimiters,

    sessionService,
    sessionController,

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

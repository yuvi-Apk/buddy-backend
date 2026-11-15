// Composition root: the only file that constructs classes and wires them together.
// Order inside createContainer: infrastructure → repositories → services → controllers.
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import type { HealthCheck } from "./core/health/health.routes.js";
import { PasswordHasher } from "./core/security/PasswordHasher.js";
import {
  createRateLimiters,
  type RateLimiters,
} from "./middlewares/rateLimit.middleware.js";

export interface Container {
  passwordHasher: PasswordHasher;
  rateLimiters: RateLimiters;
  healthChecks: Record<string, HealthCheck>;
  /** Closes database and cache connections. Called on shutdown and after tests. */
  shutdown: () => Promise<void>;
}

export function createContainer(): Container {
  // --- infrastructure ---
  const passwordHasher = new PasswordHasher();
  const rateLimiters = createRateLimiters(redis);

  return {
    passwordHasher,
    rateLimiters,

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

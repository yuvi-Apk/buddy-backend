// The Redis client: sessions, OTPs, rate limits and the role-permission cache.
import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export const redis = new Redis(env.REDIS_URL, {
  // Fail a command quickly instead of queueing it forever when Redis is down.
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
});

redis.on("error", (err: Error) => {
  // The message can contain the connection URL, so only the error code is logged.
  logger.error(
    { code: (err as NodeJS.ErrnoException).code ?? err.name },
    "Redis connection error"
  );
});

export type { Redis };

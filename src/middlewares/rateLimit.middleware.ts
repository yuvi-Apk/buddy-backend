// Rate limiters backed by Redis, so the limit is shared by every API instance (core-rules #13, #20).
// Limits are counted per client IP. Limits per phone number or per account live in the services.
import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import type { Redis } from "../config/redis.js";

interface RateLimitOptions {
  // Short unique name, used as the Redis key prefix.
  name: string;
  // Length of the counting window in seconds.
  windowSeconds: number;
  // Requests allowed per IP inside one window.
  limit: number;
}

export function createRateLimiter(
  redis: Redis,
  { name, windowSeconds, limit }: RateLimitOptions
): RequestHandler {
  return rateLimit({
    windowMs: windowSeconds * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new RedisStore({
      prefix: `rate-limit:${name}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    }),
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many requests, try again later",
        errors: [],
        data: null,
      });
    },
  });
}

export interface RateLimiters {
  // Every API route: stops one client from flooding the server.
  global: RequestHandler;
  // Login, OTP and refresh routes: slows down password and code guessing.
  auth: RequestHandler;
}

export function createRateLimiters(redis: Redis): RateLimiters {
  return {
    global: createRateLimiter(redis, {
      name: "global",
      windowSeconds: 60,
      limit: 300,
    }),
    auth: createRateLimiter(redis, {
      name: "auth",
      windowSeconds: 15 * 60,
      limit: 20,
    }),
  };
}

// The only file allowed to read process.env (RULES.md #2).
// Every variable is validated at boot; the app refuses to start on a bad or missing value.
// When you add a variable here, add it to .env.sample and .env.test as well.
import { z } from "zod";

const secret = z
  .string()
  .min(32, "must be at least 32 characters (use a long random value)");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Number of reverse proxies in front of the API (0 when none). Needed for correct client IPs.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Comma-separated list of origins allowed to call the API from a browser.
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // Admin and user tokens use different secrets so one can never pass as the other.
  ADMIN_ACCESS_TOKEN_SECRET: secret,
  USER_ACCESS_TOKEN_SECRET: secret,
  OTP_HMAC_SECRET: secret,

  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  STORAGE_DRIVER: z.enum(["local"]).default("local"),

  // Used only by `pnpm db:seed` to create the first super admin.
  SEED_SUPER_ADMIN_EMAIL: z.email().optional(),
  SEED_SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Names and reasons only. Values are never printed.
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables:\n${problems}\nSee .env.sample for the full list.`
    );
  }
  return result.data;
}

export const env = loadEnv(process.env);

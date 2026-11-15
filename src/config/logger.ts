import pino from "pino";
import { env } from "./env.js";

// core-rules #11: these fields are replaced with "[REDACTED]" wherever they appear in a log line.
const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "password",
  "*.password",
  "otp",
  "*.otp",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
];

export const loggerOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
};

export const logger = pino(loggerOptions);

// Builds the Express app. The order of middleware here matters; read top to bottom.
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import type { Container } from "./container.js";
import { notFound } from "./middlewares/notFound.middleware.js";
import { createApiRouter } from "./routes.js";
import { errorHandler } from "./utils/errorHandler.js";

export const API_PREFIX = "/api/v1";

export function createApp(container: Container): Express {
  const app = express();

  app.disable("x-powered-by");
  // Needed so req.ip is the real client IP behind a load balancer (used by rate limits).
  app.set("trust proxy", env.TRUST_PROXY);

  // 1. Request log with a request ID, also returned as the x-request-id header.
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
    })
  );

  // 2. Security headers.
  app.use(helmet());

  // 3. CORS: only origins listed in CORS_ORIGINS may call the API from a browser.
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));

  // 4. Body parsing with a size cap. Uploads use multer on their own routes.
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // 5. Routes.
  app.use(API_PREFIX, createApiRouter(container));

  // 6. Fallbacks. These two must stay last.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

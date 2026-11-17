// Public entry point of the session module. Other code imports from here only.
import { env } from "../../../config/env.js";
import type { TokenService } from "../../../core/security/TokenService.js";
import { ownAccountRoute } from "../../../middlewares/routeGuard.js";
import type { Infra, RouterDeps } from "../../../types/module.types.js";
import { SessionController } from "./session.controller.js";
import { SessionRepository } from "./session.repository.js";
import { createSessionRouter } from "./session.routes.js";
import { SessionService } from "./session.service.js";

export function createSessionModule(
  { prisma, redis, logger }: Infra,
  deps: { tokenService: TokenService }
) {
  const repository = new SessionRepository(prisma);
  const service = new SessionService(
    repository,
    deps.tokenService,
    redis,
    logger,
    { refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS }
  );
  const controller = new SessionController(service);

  return {
    service,
    // The same routes are mounted twice; each caller only ever sees their own sessions.
    adminRouter: ({ guards }: RouterDeps) =>
      createSessionRouter(controller, [guards.verifyAdmin, ownAccountRoute()]),
    userRouter: ({ guards }: RouterDeps) =>
      createSessionRouter(controller, [guards.verifyUser]),
  };
}

export type SessionModule = ReturnType<typeof createSessionModule>;
export type { SessionService } from "./session.service.js";
export type {
  ClientInfo,
  IssuedSession,
  SessionDto,
  SessionOwner,
  SessionOwnerType,
} from "./session.schema.js";

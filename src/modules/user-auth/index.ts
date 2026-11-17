// Public entry point of the user-auth module. Other code imports from here only.
import { env } from "../../config/env.js";
import type { GoogleTokenVerifier } from "../../core/security/GoogleIdTokenVerifier.js";
import type { TokenService } from "../../core/security/TokenService.js";
import type { Infra, RouterDeps } from "../../types/module.types.js";
import type { SessionService } from "../session/index.js";
import { UserAuthController } from "./user-auth.controller.js";
import { UserAuthRepository } from "./user-auth.repository.js";
import { createUserAuthRouter } from "./user-auth.routes.js";
import { UserAuthService } from "./user-auth.service.js";

export function createUserAuthModule(
  { prisma }: Infra,
  deps: {
    sessionService: SessionService;
    tokenService: TokenService;
    googleTokenVerifier: GoogleTokenVerifier;
  }
) {
  const repository = new UserAuthRepository(prisma);
  const service = new UserAuthService(
    repository,
    deps.sessionService,
    deps.tokenService,
    deps.googleTokenVerifier
  );
  const controller = new UserAuthController(service, {
    secure: env.NODE_ENV === "production",
  });

  return {
    service,
    router: ({ guards, rateLimiters }: RouterDeps) =>
      createUserAuthRouter(controller, {
        verifyUser: guards.verifyUser,
        authRateLimit: rateLimiters.auth,
      }),
  };
}

export type UserAuthModule = ReturnType<typeof createUserAuthModule>;
export type { UserAuthService } from "./user-auth.service.js";
export type { AuthenticatedUser } from "./user-auth.schema.js";

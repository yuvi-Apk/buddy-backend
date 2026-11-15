// Public entry point of the user-auth module. Other code imports from here only.
import type { OtpSender } from "../../core/otp/OtpSender.js";
import type { OtpService } from "../../core/otp/OtpService.js";
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
    otpService: OtpService;
    otpSender: OtpSender;
  }
) {
  const repository = new UserAuthRepository(prisma);
  const service = new UserAuthService(
    repository,
    deps.sessionService,
    deps.tokenService,
    deps.otpService,
    deps.otpSender
  );
  const controller = new UserAuthController(service);

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

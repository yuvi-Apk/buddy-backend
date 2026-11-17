// Public entry point of the join-request module (Way 2: ask to join with an organization's
// join code; an organization admin approves or rejects).
import type { Infra, RouterDeps } from "../../types/module.types.js";
import type { ClassroomService } from "../classroom/index.js";
import type { OrganizationService } from "../organization/index.js";
import { JoinRequestController } from "./join-request.controller.js";
import { JoinRequestRepository } from "./join-request.repository.js";
import { createJoinRequestRouter } from "./join-request.routes.js";
import { JoinRequestService } from "./join-request.service.js";

export function createJoinRequestModule(
  { prisma }: Infra,
  deps: {
    organizationService: OrganizationService;
    classroomService: ClassroomService;
  }
) {
  const repository = new JoinRequestRepository(prisma);
  const service = new JoinRequestService(
    repository,
    deps.organizationService,
    deps.classroomService
  );
  const controller = new JoinRequestController(service);

  return {
    router: ({ guards, rateLimiters }: RouterDeps) =>
      createJoinRequestRouter(controller, {
        ...guards,
        joinCodeRateLimit: rateLimiters.joinCode,
      }),
  };
}

export type JoinRequestModule = ReturnType<typeof createJoinRequestModule>;

// Public entry point of the invite module (Way 1: join by an email invite link).
// No email is sent yet: creating an invite returns the link once, and the sender shares it.
import { env } from "../../../config/env.js";
import type { Infra, RouterDeps } from "../../../types/module.types.js";
import type { ClassroomService } from "../../user-panel/classroom/index.js";
import type { OrganizationService } from "../organization/index.js";
import { InviteAdminController } from "./invite.admin.controller.js";
import { createInviteAdminRouter } from "./invite.admin.routes.js";
import { InviteRepository } from "./invite.repository.js";
import { InviteService } from "./invite.service.js";
import { InviteUserController } from "./invite.user.controller.js";
import { createInviteUserRouter } from "./invite.user.routes.js";

export function createInviteModule(
  { prisma }: Infra,
  deps: {
    organizationService: OrganizationService;
    classroomService: ClassroomService;
  }
) {
  const repository = new InviteRepository(prisma);
  const service = new InviteService(
    repository,
    deps.organizationService,
    deps.classroomService,
    env.INVITE_LINK_BASE_URL
  );
  const adminController = new InviteAdminController(service);
  const userController = new InviteUserController(service);

  return {
    // No extra rate limit on accept: the token is 256 random bits, so guessing is hopeless.
    userRouter: ({ guards }: RouterDeps) =>
      createInviteUserRouter(userController, guards),
    adminRouter: ({ guards }: RouterDeps) =>
      createInviteAdminRouter(adminController, guards),
  };
}

export type InviteModule = ReturnType<typeof createInviteModule>;
export type { InviteDto } from "./invite.schema.js";

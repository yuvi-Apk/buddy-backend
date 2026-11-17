// Public entry point of the organization module. Other code imports from here only.
// Owns organizations, memberships, and the two membership columns on users
// (canJoinMultipleOrganizations, activeMembershipCount) that the join rule keeps in step.
import type { Infra, RouterDeps } from "../../../types/module.types.js";
import type { UserAuthService } from "../../user-panel/user-auth/index.js";
import { OrganizationAdminController } from "./organization.admin.controller.js";
import {
  createMembershipSettingsAdminRouter,
  createOrganizationAdminRouter,
} from "./organization.admin.routes.js";
import { OrganizationRepository } from "./organization.repository.js";
import { OrganizationService } from "./organization.service.js";
import { OrganizationUserController } from "./organization.user.controller.js";
import { createOrganizationUserRouter } from "./organization.user.routes.js";

export function createOrganizationModule(
  { prisma }: Infra,
  deps: { userAuthService: UserAuthService }
) {
  const repository = new OrganizationRepository(prisma);
  const service = new OrganizationService(repository, deps.userAuthService);
  const adminController = new OrganizationAdminController(service);
  const userController = new OrganizationUserController(service);

  return {
    service,
    adminRouter: ({ guards }: RouterDeps) =>
      createOrganizationAdminRouter(adminController, guards),
    membershipSettingsAdminRouter: ({ guards }: RouterDeps) =>
      createMembershipSettingsAdminRouter(adminController, guards),
    userRouter: ({ guards }: RouterDeps) =>
      createOrganizationUserRouter(userController, guards),
  };
}

export type OrganizationModule = ReturnType<typeof createOrganizationModule>;
export type { OrganizationService } from "./organization.service.js";
export type {
  JoinOrganizationInput,
  JoinRefusal,
} from "./organization.repository.js";
export type {
  ActiveMembership,
  MembershipRole,
  OrganizationDto,
} from "./organization.schema.js";
export { ORGANIZATION_ID_HEADER } from "./organization.schema.js";

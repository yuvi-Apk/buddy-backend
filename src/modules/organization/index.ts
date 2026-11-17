// Public entry point of the organization module. Other code imports from here only.
// Owns organizations, memberships, and the two membership columns on users
// (canJoinMultipleOrganizations, activeMembershipCount) that the join rule keeps in step.
import type { Infra, RouterDeps } from "../../types/module.types.js";
import type { UserAuthService } from "../user-auth/index.js";
import { OrganizationController } from "./organization.controller.js";
import { OrganizationRepository } from "./organization.repository.js";
import {
  createMembershipSettingsAdminRouter,
  createOrganizationAdminRouter,
  createOrganizationUserRouter,
} from "./organization.routes.js";
import { OrganizationService } from "./organization.service.js";

export function createOrganizationModule(
  { prisma }: Infra,
  deps: { userAuthService: UserAuthService }
) {
  const repository = new OrganizationRepository(prisma);
  const service = new OrganizationService(repository, deps.userAuthService);
  const controller = new OrganizationController(service);

  return {
    service,
    adminRouter: ({ guards }: RouterDeps) =>
      createOrganizationAdminRouter(controller, guards),
    membershipSettingsAdminRouter: ({ guards }: RouterDeps) =>
      createMembershipSettingsAdminRouter(controller, guards),
    userRouter: ({ guards }: RouterDeps) =>
      createOrganizationUserRouter(controller, guards),
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

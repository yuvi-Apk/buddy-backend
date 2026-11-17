// Public entry point of the classroom module. Other code imports from here only.
import type { Infra, RouterDeps } from "../../types/module.types.js";
import type { OrganizationService } from "../organization/index.js";
import { ClassroomController } from "./classroom.controller.js";
import { ClassroomRepository } from "./classroom.repository.js";
import { createClassroomRouter } from "./classroom.routes.js";
import { ClassroomService } from "./classroom.service.js";

export function createClassroomModule(
  { prisma }: Infra,
  deps: { organizationService: OrganizationService }
) {
  const repository = new ClassroomRepository(prisma);
  const service = new ClassroomService(repository, deps.organizationService);
  const controller = new ClassroomController(service);

  return {
    router: ({ guards }: RouterDeps) =>
      createClassroomRouter(controller, guards),
  };
}

export type ClassroomModule = ReturnType<typeof createClassroomModule>;
export type { ClassroomDto } from "./classroom.schema.js";

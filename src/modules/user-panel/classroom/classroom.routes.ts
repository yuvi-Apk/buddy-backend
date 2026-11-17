import { Router, type RequestHandler } from "express";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { MembershipRole } from "../../shared/organization/index.js";
import type { ClassroomController } from "./classroom.controller.js";
import {
  addClassroomMemberBody,
  classroomIdParams,
  classroomMemberParams,
  createClassroomBody,
  listClassroomMembersQuery,
  listClassroomsQuery,
  updateClassroomBody,
} from "./classroom.schema.js";

interface Deps {
  verifyUser: RequestHandler;
  requireOrganizationRole: (...roles: MembershipRole[]) => RequestHandler;
}

// Mounted at /user/classrooms. Every route acts inside the X-Organization-Id organization.
export function createClassroomRouter(
  controller: ClassroomController,
  { verifyUser, requireOrganizationRole }: Deps
): Router {
  const router = Router();
  const anyMember = requireOrganizationRole();
  const organizationAdmin = requireOrganizationRole("ORGANIZATION_ADMIN");
  const organizationAdminOrTeacher = requireOrganizationRole(
    "ORGANIZATION_ADMIN",
    "TEACHER"
  );

  router.get(
    "/",
    verifyUser,
    anyMember,
    validate({ query: listClassroomsQuery }),
    asyncHandler(controller.list)
  );

  router.post(
    "/",
    verifyUser,
    organizationAdmin,
    validate({ body: createClassroomBody }),
    asyncHandler(controller.create)
  );

  router.get(
    "/:id",
    verifyUser,
    anyMember,
    validate({ params: classroomIdParams }),
    asyncHandler(controller.getById)
  );

  router.patch(
    "/:id",
    verifyUser,
    organizationAdmin,
    validate({ params: classroomIdParams, body: updateClassroomBody }),
    asyncHandler(controller.update)
  );

  router.get(
    "/:id/members",
    verifyUser,
    organizationAdminOrTeacher,
    validate({ params: classroomIdParams, query: listClassroomMembersQuery }),
    asyncHandler(controller.listMembers)
  );

  router.post(
    "/:id/members",
    verifyUser,
    organizationAdmin,
    validate({ params: classroomIdParams, body: addClassroomMemberBody }),
    asyncHandler(controller.addMember)
  );

  router.delete(
    "/:id/members/:membershipId",
    verifyUser,
    organizationAdmin,
    validate({ params: classroomMemberParams }),
    asyncHandler(controller.removeMember)
  );

  return router;
}

import { ApiError } from "../../utils/ApiError.js";
import { paginated, type Paginated } from "../../utils/pagination.js";
import type {
  ActiveMembership,
  OrganizationService,
} from "../organization/index.js";
import type { ClassroomRepository } from "./classroom.repository.js";
import type {
  ClassroomDto,
  ClassroomMemberDto,
  CreateClassroomBody,
  ListClassroomMembersQuery,
  ListClassroomsQuery,
  UpdateClassroomBody,
} from "./classroom.schema.js";

// Who sees what: organization admins see every classroom of their organization; teachers
// and students only the ones they are in. Anything else answers 404 (core-rules #8).
export class ClassroomService {
  constructor(
    private readonly classrooms: ClassroomRepository,
    private readonly organizations: OrganizationService
  ) {}

  async list(
    caller: ActiveMembership,
    query: ListClassroomsQuery
  ): Promise<Paginated<ClassroomDto>> {
    const { items, total } = await this.classrooms.list(
      caller.organizationId,
      query,
      this.onlyOwnClassrooms(caller)
    );
    return paginated(items, total, query);
  }

  async getById(
    caller: ActiveMembership,
    classroomId: string
  ): Promise<ClassroomDto> {
    const classroom = await this.classrooms.findById(
      caller.organizationId,
      classroomId,
      this.onlyOwnClassrooms(caller)
    );
    if (!classroom) throw ApiError.notFound("Classroom not found");
    return classroom;
  }

  // A duplicate name in the organization hits the unique index: 409 in errorHandler.
  create(
    caller: ActiveMembership,
    input: CreateClassroomBody
  ): Promise<ClassroomDto> {
    return this.classrooms.create(caller.organizationId, input);
  }

  async update(
    caller: ActiveMembership,
    classroomId: string,
    input: UpdateClassroomBody
  ): Promise<ClassroomDto> {
    const classroom = await this.classrooms.update(
      caller.organizationId,
      classroomId,
      input
    );
    if (!classroom) throw ApiError.notFound("Classroom not found");
    return classroom;
  }

  // Organization admins, and teachers of this classroom.
  async listMembers(
    caller: ActiveMembership,
    classroomId: string,
    query: ListClassroomMembersQuery
  ): Promise<Paginated<ClassroomMemberDto>> {
    await this.getById(caller, classroomId);
    const { items, total } = await this.classrooms.listMembers(
      caller.organizationId,
      classroomId,
      query
    );
    return paginated(items, total, query);
  }

  async addMember(
    caller: ActiveMembership,
    classroomId: string,
    membershipId: string
  ): Promise<void> {
    const classroom = await this.getById(caller, classroomId);
    if (classroom.isArchived) {
      throw ApiError.conflict("This classroom is archived");
    }
    const member = await this.organizations.findActiveMember(
      caller.organizationId,
      membershipId
    );
    if (!member) throw ApiError.notFound("Member not found");

    const added = await this.classrooms.addMember(
      caller.organizationId,
      classroomId,
      membershipId
    );
    if (!added) throw ApiError.conflict("Already in this classroom");
  }

  async removeMember(
    caller: ActiveMembership,
    classroomId: string,
    membershipId: string
  ): Promise<void> {
    await this.getById(caller, classroomId);
    const removed = await this.classrooms.removeMember(
      caller.organizationId,
      classroomId,
      membershipId
    );
    if (!removed) throw ApiError.notFound("Member not found");
  }

  private onlyOwnClassrooms(caller: ActiveMembership): string | undefined {
    return caller.role === "ORGANIZATION_ADMIN" ? undefined : caller.id;
  }
}

import type { Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import type { ActiveMembership } from "../../shared/organization/index.js";
import type {
  AddClassroomMemberBody,
  ClassroomIdParams,
  ClassroomMemberParams,
  CreateClassroomBody,
  ListClassroomMembersQuery,
  ListClassroomsQuery,
  UpdateClassroomBody,
} from "./classroom.schema.js";
import type { ClassroomService } from "./classroom.service.js";

export class ClassroomController {
  constructor(private readonly classroomService: ClassroomService) {}

  list = async (req: Request, res: Response) => {
    const query = req.validated.query as ListClassroomsQuery;
    const data = await this.classroomService.list(this.caller(req), query);
    res.status(200).json(new ApiResponse(200, data, "Classrooms fetched"));
  };

  getById = async (req: Request, res: Response) => {
    const { id } = req.validated.params as ClassroomIdParams;
    const data = await this.classroomService.getById(this.caller(req), id);
    res.status(200).json(new ApiResponse(200, data, "Classroom fetched"));
  };

  create = async (req: Request, res: Response) => {
    const input = req.validated.body as CreateClassroomBody;
    const data = await this.classroomService.create(this.caller(req), input);
    res.status(201).json(new ApiResponse(201, data, "Classroom created"));
  };

  update = async (req: Request, res: Response) => {
    const { id } = req.validated.params as ClassroomIdParams;
    const input = req.validated.body as UpdateClassroomBody;
    const data = await this.classroomService.update(
      this.caller(req),
      id,
      input
    );
    res.status(200).json(new ApiResponse(200, data, "Classroom updated"));
  };

  listMembers = async (req: Request, res: Response) => {
    const { id } = req.validated.params as ClassroomIdParams;
    const query = req.validated.query as ListClassroomMembersQuery;
    const data = await this.classroomService.listMembers(
      this.caller(req),
      id,
      query
    );
    res.status(200).json(new ApiResponse(200, data, "Members fetched"));
  };

  addMember = async (req: Request, res: Response) => {
    const { id } = req.validated.params as ClassroomIdParams;
    const { membershipId } = req.validated.body as AddClassroomMemberBody;
    await this.classroomService.addMember(this.caller(req), id, membershipId);
    res.status(201).json(new ApiResponse(201, null, "Added to the classroom"));
  };

  removeMember = async (req: Request, res: Response) => {
    const { id, membershipId } = req.validated.params as ClassroomMemberParams;
    await this.classroomService.removeMember(
      this.caller(req),
      id,
      membershipId
    );
    res
      .status(200)
      .json(new ApiResponse(200, null, "Removed from the classroom"));
  };

  private caller(req: Request): ActiveMembership {
    if (!req.membership) throw ApiError.unauthorized();
    return req.membership;
  }
}

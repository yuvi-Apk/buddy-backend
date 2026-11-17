// Super admin panel handlers for /admin/organizations and /admin/users.
import type { Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import type {
  AddOrganizationAdminBody,
  CreateOrganizationBody,
  ListMembersQuery,
  ListOrganizationsQuery,
  OrganizationIdParams,
  UpdateMembershipSettingsBody,
  UpdateOrganizationBody,
  UserIdParams,
} from "./organization.schema.js";
import type { OrganizationService } from "./organization.service.js";

export class OrganizationAdminController {
  constructor(private readonly organizationService: OrganizationService) {}

  list = async (req: Request, res: Response) => {
    const query = req.validated.query as ListOrganizationsQuery;
    const data = await this.organizationService.list(query);
    res.status(200).json(new ApiResponse(200, data, "Organizations fetched"));
  };

  getById = async (req: Request, res: Response) => {
    const { id } = req.validated.params as OrganizationIdParams;
    const data = await this.organizationService.getById(id);
    res.status(200).json(new ApiResponse(200, data, "Organization fetched"));
  };

  create = async (req: Request, res: Response) => {
    const input = req.validated.body as CreateOrganizationBody;
    const data = await this.organizationService.create(
      input,
      this.adminId(req)
    );
    res.status(201).json(new ApiResponse(201, data, "Organization created"));
  };

  update = async (req: Request, res: Response) => {
    const { id } = req.validated.params as OrganizationIdParams;
    const input = req.validated.body as UpdateOrganizationBody;
    const data = await this.organizationService.update(id, input);
    res.status(200).json(new ApiResponse(200, data, "Organization updated"));
  };

  regenerateJoinCode = async (req: Request, res: Response) => {
    const { id } = req.validated.params as OrganizationIdParams;
    const data = await this.organizationService.regenerateJoinCode(id);
    res.status(200).json(new ApiResponse(200, data, "Join code changed"));
  };

  listMembers = async (req: Request, res: Response) => {
    const { id } = req.validated.params as OrganizationIdParams;
    const query = req.validated.query as ListMembersQuery;
    const data = await this.organizationService.listMembers(id, query);
    res.status(200).json(new ApiResponse(200, data, "Members fetched"));
  };

  addOrganizationAdmin = async (req: Request, res: Response) => {
    const { id } = req.validated.params as OrganizationIdParams;
    const { email } = req.validated.body as AddOrganizationAdminBody;
    const { member, isNewMember } =
      await this.organizationService.addOrganizationAdmin(id, email);
    const status = isNewMember ? 201 : 200;
    res
      .status(status)
      .json(new ApiResponse(status, member, "Organization admin added"));
  };

  updateMembershipSettings = async (req: Request, res: Response) => {
    const { userId } = req.validated.params as UserIdParams;
    const { canJoinMultipleOrganizations } = req.validated
      .body as UpdateMembershipSettingsBody;
    const data = await this.organizationService.updateMembershipSettings(
      userId,
      canJoinMultipleOrganizations
    );
    res
      .status(200)
      .json(new ApiResponse(200, data, "Membership settings updated"));
  };

  private adminId(req: Request): string {
    if (!req.admin) throw ApiError.unauthorized();
    return req.admin.id;
  }
}

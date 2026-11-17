import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import type {
  ActiveMembership,
  AddOrganizationAdminBody,
  CreateOrganizationBody,
  ListMembersQuery,
  ListMyOrganizationsQuery,
  ListOrganizationsQuery,
  MembershipIdParams,
  OrganizationIdParams,
  UpdateJoinCodeBody,
  UpdateMemberBody,
  UpdateMembershipSettingsBody,
  UpdateOrganizationBody,
  UserIdParams,
} from "./organization.schema.js";
import type { OrganizationService } from "./organization.service.js";

export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  // ===========================================================================
  // Admin panel
  // ===========================================================================

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

  // ===========================================================================
  // App (user panel)
  // ===========================================================================

  listMine = async (req: Request, res: Response) => {
    const query = req.validated.query as ListMyOrganizationsQuery;
    const data = await this.organizationService.listMyOrganizations(
      this.userId(req),
      query
    );
    res.status(200).json(new ApiResponse(200, data, "Organizations fetched"));
  };

  getCurrent = async (req: Request, res: Response) => {
    const data = await this.organizationService.getCurrent(
      this.membership(req),
      this.userId(req)
    );
    res.status(200).json(new ApiResponse(200, data, "Organization fetched"));
  };

  getJoinCode = async (req: Request, res: Response) => {
    const data = await this.organizationService.getJoinCode(
      this.membership(req).organizationId
    );
    res.status(200).json(new ApiResponse(200, data, "Join code fetched"));
  };

  updateJoinCode = async (req: Request, res: Response) => {
    const { isJoinCodeEnabled } = req.validated.body as UpdateJoinCodeBody;
    const data = await this.organizationService.setJoinCodeEnabled(
      this.membership(req).organizationId,
      isJoinCodeEnabled
    );
    res.status(200).json(new ApiResponse(200, data, "Join code updated"));
  };

  regenerateOwnJoinCode = async (req: Request, res: Response) => {
    const data = await this.organizationService.regenerateOwnJoinCode(
      this.membership(req).organizationId
    );
    res.status(200).json(new ApiResponse(200, data, "Join code changed"));
  };

  listCurrentMembers = async (req: Request, res: Response) => {
    const query = req.validated.query as ListMembersQuery;
    const data = await this.organizationService.listCurrentMembers(
      this.membership(req).organizationId,
      query
    );
    res.status(200).json(new ApiResponse(200, data, "Members fetched"));
  };

  updateMember = async (req: Request, res: Response) => {
    const { membershipId } = req.validated.params as MembershipIdParams;
    const change = req.validated.body as UpdateMemberBody;
    const data = await this.organizationService.updateMember(
      this.membership(req),
      membershipId,
      change
    );
    res.status(200).json(new ApiResponse(200, data, "Member updated"));
  };

  removeMember = async (req: Request, res: Response) => {
    const { membershipId } = req.validated.params as MembershipIdParams;
    await this.organizationService.removeMember(
      this.membership(req),
      membershipId
    );
    res.status(200).json(new ApiResponse(200, null, "Member removed"));
  };

  leave = async (req: Request, res: Response) => {
    await this.organizationService.leave(this.membership(req));
    res
      .status(200)
      .json(new ApiResponse(200, null, "You left the organization"));
  };

  // ===========================================================================
  // Internals
  // ===========================================================================

  private adminId(req: Request): string {
    if (!req.admin) throw ApiError.unauthorized();
    return req.admin.id;
  }

  private userId(req: Request): string {
    if (!req.user) throw ApiError.unauthorized();
    return req.user.id;
  }

  private membership(req: Request): ActiveMembership {
    if (!req.membership) throw ApiError.unauthorized();
    return req.membership;
  }
}

// User panel handlers for /user/organizations.
import type { Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import type {
  ActiveMembership,
  ListMembersQuery,
  ListMyOrganizationsQuery,
  MembershipIdParams,
  UpdateJoinCodeBody,
  UpdateMemberBody,
} from "./organization.schema.js";
import type { OrganizationService } from "./organization.service.js";

export class OrganizationUserController {
  constructor(private readonly organizationService: OrganizationService) {}

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

  private userId(req: Request): string {
    if (!req.user) throw ApiError.unauthorized();
    return req.user.id;
  }

  private membership(req: Request): ActiveMembership {
    if (!req.membership) throw ApiError.unauthorized();
    return req.membership;
  }
}

// Super admin panel handlers for /admin/organizations/:organizationId/invites.
import type { Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import type {
  AdminInviteParams,
  AdminOrganizationParams,
  CreateInviteBody,
  ListInvitesQuery,
} from "./invite.schema.js";
import type { InviteService } from "./invite.service.js";

export class InviteAdminController {
  constructor(private readonly inviteService: InviteService) {}

  create = async (req: Request, res: Response) => {
    const { organizationId } = req.validated.params as AdminOrganizationParams;
    const input = req.validated.body as CreateInviteBody;
    const data = await this.inviteService.createAsAdmin(
      organizationId,
      this.adminId(req),
      input
    );
    res.status(201).json(new ApiResponse(201, data, "Invite created"));
  };

  list = async (req: Request, res: Response) => {
    const { organizationId } = req.validated.params as AdminOrganizationParams;
    const query = req.validated.query as ListInvitesQuery;
    const data = await this.inviteService.listAsAdmin(organizationId, query);
    res.status(200).json(new ApiResponse(200, data, "Invites fetched"));
  };

  revoke = async (req: Request, res: Response) => {
    const { organizationId, inviteId } = req.validated
      .params as AdminInviteParams;
    const data = await this.inviteService.revoke(organizationId, inviteId);
    res.status(200).json(new ApiResponse(200, data, "Invite revoked"));
  };

  private adminId(req: Request): string {
    if (!req.admin) throw ApiError.unauthorized();
    return req.admin.id;
  }
}

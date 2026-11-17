// User panel handlers for /user/invites: organization admins and the invited person.
import type { Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import type { AuthenticatedUser } from "../../user-panel/user-auth/index.js";
import type { ActiveMembership } from "../organization/index.js";
import type {
  AcceptInviteBody,
  AcceptInviteByTokenBody,
  CreateInviteBody,
  InviteIdParams,
  ListInvitesQuery,
  ListReceivedInvitesQuery,
} from "./invite.schema.js";
import type { InviteService } from "./invite.service.js";

export class InviteUserController {
  constructor(private readonly inviteService: InviteService) {}

  // ===========================================================================
  // Organization admins
  // ===========================================================================

  create = async (req: Request, res: Response) => {
    const input = req.validated.body as CreateInviteBody;
    const data = await this.inviteService.createAsOrganizationAdmin(
      this.membership(req),
      this.user(req).id,
      input
    );
    res.status(201).json(new ApiResponse(201, data, "Invite created"));
  };

  list = async (req: Request, res: Response) => {
    const query = req.validated.query as ListInvitesQuery;
    const data = await this.inviteService.list(
      this.membership(req).organizationId,
      query
    );
    res.status(200).json(new ApiResponse(200, data, "Invites fetched"));
  };

  revoke = async (req: Request, res: Response) => {
    const { id } = req.validated.params as InviteIdParams;
    const data = await this.inviteService.revoke(
      this.membership(req).organizationId,
      id
    );
    res.status(200).json(new ApiResponse(200, data, "Invite revoked"));
  };

  // ===========================================================================
  // The invited person
  // ===========================================================================

  listReceived = async (req: Request, res: Response) => {
    const query = req.validated.query as ListReceivedInvitesQuery;
    const data = await this.inviteService.listReceived(this.user(req), query);
    res.status(200).json(new ApiResponse(200, data, "Invites fetched"));
  };

  acceptByToken = async (req: Request, res: Response) => {
    const { token, sharePastDataWithOrganization } = req.validated
      .body as AcceptInviteByTokenBody;
    const data = await this.inviteService.acceptByToken(
      this.user(req),
      token,
      sharePastDataWithOrganization
    );
    res.status(200).json(new ApiResponse(200, data, "Invite accepted"));
  };

  acceptById = async (req: Request, res: Response) => {
    const { id } = req.validated.params as InviteIdParams;
    const { sharePastDataWithOrganization } = req.validated
      .body as AcceptInviteBody;
    const data = await this.inviteService.acceptById(
      this.user(req),
      id,
      sharePastDataWithOrganization
    );
    res.status(200).json(new ApiResponse(200, data, "Invite accepted"));
  };

  // ===========================================================================
  // Internals
  // ===========================================================================

  private user(req: Request): AuthenticatedUser {
    if (!req.user) throw ApiError.unauthorized();
    return req.user;
  }

  private membership(req: Request): ActiveMembership {
    if (!req.membership) throw ApiError.unauthorized();
    return req.membership;
  }
}

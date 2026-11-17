import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import type { ActiveMembership } from "../organization/index.js";
import type {
  ApproveJoinRequestBody,
  CreateJoinRequestBody,
  JoinRequestIdParams,
  ListJoinRequestsQuery,
  RejectJoinRequestBody,
} from "./join-request.schema.js";
import type { JoinRequestService } from "./join-request.service.js";

export class JoinRequestController {
  constructor(private readonly joinRequestService: JoinRequestService) {}

  // ===========================================================================
  // The person asking
  // ===========================================================================

  create = async (req: Request, res: Response) => {
    const input = req.validated.body as CreateJoinRequestBody;
    const data = await this.joinRequestService.create(this.userId(req), input);
    res.status(201).json(new ApiResponse(201, data, "Request sent"));
  };

  listMine = async (req: Request, res: Response) => {
    const query = req.validated.query as ListJoinRequestsQuery;
    const data = await this.joinRequestService.listMine(
      this.userId(req),
      query
    );
    res.status(200).json(new ApiResponse(200, data, "Requests fetched"));
  };

  cancel = async (req: Request, res: Response) => {
    const { id } = req.validated.params as JoinRequestIdParams;
    const data = await this.joinRequestService.cancel(this.userId(req), id);
    res.status(200).json(new ApiResponse(200, data, "Request cancelled"));
  };

  // ===========================================================================
  // Organization admins
  // ===========================================================================

  listForReview = async (req: Request, res: Response) => {
    const query = req.validated.query as ListJoinRequestsQuery;
    const data = await this.joinRequestService.listForReview(
      this.membership(req),
      query
    );
    res.status(200).json(new ApiResponse(200, data, "Requests fetched"));
  };

  approve = async (req: Request, res: Response) => {
    const { id } = req.validated.params as JoinRequestIdParams;
    const input = req.validated.body as ApproveJoinRequestBody;
    const data = await this.joinRequestService.approve(
      this.membership(req),
      this.userId(req),
      id,
      input
    );
    res.status(200).json(new ApiResponse(200, data, "Request approved"));
  };

  reject = async (req: Request, res: Response) => {
    const { id } = req.validated.params as JoinRequestIdParams;
    const { reviewNote } = req.validated.body as RejectJoinRequestBody;
    const data = await this.joinRequestService.reject(
      this.membership(req),
      this.userId(req),
      id,
      reviewNote
    );
    res.status(200).json(new ApiResponse(200, data, "Request rejected"));
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

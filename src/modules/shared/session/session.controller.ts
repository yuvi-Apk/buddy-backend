import type { Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import type { SessionIdParams, SessionOwner } from "./session.schema.js";
import type { SessionService } from "./session.service.js";

export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  // Lists the caller's own active sessions (their logged-in devices).
  list = async (req: Request, res: Response) => {
    const owner = this.currentOwner(req);
    const sessions = await this.sessionService.listForOwner(owner);

    const data = sessions.map((session) => ({
      ...session,
      isCurrent: session.id === req.auth?.sessionId,
    }));
    res.status(200).json(new ApiResponse(200, data, "Sessions fetched"));
  };

  // Logs out one of the caller's own sessions.
  revoke = async (req: Request, res: Response) => {
    const owner = this.currentOwner(req);
    const { id } = req.validated.params as SessionIdParams;

    await this.sessionService.revokeOwned(id, owner);
    res.status(200).json(new ApiResponse(200, null, "Session revoked"));
  };

  private currentOwner(req: Request): SessionOwner {
    if (!req.auth) throw ApiError.unauthorized();
    return req.auth.owner;
  }
}

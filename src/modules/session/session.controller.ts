import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import type { SessionIdParams, Subject } from "./session.schema.js";
import type { SessionService } from "./session.service.js";

export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  // Lists the caller's own active sessions (their logged-in devices).
  list = async (req: Request, res: Response) => {
    const subject = this.currentSubject(req);
    const sessions = await this.sessionService.listForSubject(subject);

    const data = sessions.map((session) => ({
      ...session,
      isCurrent: session.id === req.auth?.sessionId,
    }));
    res.status(200).json(new ApiResponse(200, data, "Sessions fetched"));
  };

  // Logs out one of the caller's own sessions.
  revoke = async (req: Request, res: Response) => {
    const subject = this.currentSubject(req);
    const { id } = req.validated.params as SessionIdParams;

    await this.sessionService.revokeOwned(id, subject);
    res.status(200).json(new ApiResponse(200, null, "Session revoked"));
  };

  private currentSubject(req: Request): Subject {
    if (!req.auth) throw ApiError.unauthorized();
    return req.auth.subject;
  }
}

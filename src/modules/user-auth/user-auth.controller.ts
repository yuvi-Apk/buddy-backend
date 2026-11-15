import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { clientInfo } from "../../utils/clientInfo.js";
import type {
  RequestOtpBody,
  UserRefreshBody,
  VerifyOtpBody,
} from "./user-auth.schema.js";
import type { UserAuthService } from "./user-auth.service.js";

export class UserAuthController {
  constructor(private readonly userAuthService: UserAuthService) {}

  requestOtp = async (req: Request, res: Response) => {
    const { phone } = req.validated.body as RequestOtpBody;
    await this.userAuthService.requestOtp(phone);

    // Same answer for new and existing numbers.
    res.status(200).json(new ApiResponse(200, null, "Code sent"));
  };

  verifyOtp = async (req: Request, res: Response) => {
    const input = req.validated.body as VerifyOtpBody;
    const result = await this.userAuthService.verifyOtp(input, clientInfo(req));
    res.status(200).json(new ApiResponse(200, result, "Logged in"));
  };

  refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.validated.body as UserRefreshBody;
    const result = await this.userAuthService.refresh(
      refreshToken,
      clientInfo(req)
    );
    res.status(200).json(new ApiResponse(200, result, "Token refreshed"));
  };

  logout = async (req: Request, res: Response) => {
    if (!req.auth) throw ApiError.unauthorized();
    await this.userAuthService.logout(req.auth.sessionId);
    res.status(200).json(new ApiResponse(200, null, "Logged out"));
  };

  me = (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(200).json(new ApiResponse(200, req.user, "Profile fetched"));
  };
}

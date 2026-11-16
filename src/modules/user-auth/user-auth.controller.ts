import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { clientInfo } from "../../utils/clientInfo.js";
import type {
  UserGoogleSignInBody,
  UserRefreshBody,
} from "./user-auth.schema.js";
import type { UserAuthService } from "./user-auth.service.js";

export class UserAuthController {
  constructor(private readonly userAuthService: UserAuthService) {}

  signInWithGoogle = async (req: Request, res: Response) => {
    const { idToken } = req.validated.body as UserGoogleSignInBody;
    const result = await this.userAuthService.signInWithGoogle(
      idToken,
      clientInfo(req)
    );
    res.status(200).json(new ApiResponse(200, result, "Signed in"));
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

  logoutAllDevices = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    await this.userAuthService.logoutAllDevices(req.user.id);
    res
      .status(200)
      .json(new ApiResponse(200, null, "Logged out of all devices"));
  };

  me = (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(200).json(new ApiResponse(200, req.user, "Profile fetched"));
  };
}

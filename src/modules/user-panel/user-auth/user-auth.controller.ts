import type { CookieOptions, Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import { clientInfo } from "../../../utils/clientInfo.js";
import type {
  UpdateUserProfileBody,
  UserGoogleSignInBody,
  UserRefreshBody,
  UserSignInResult,
} from "./user-auth.schema.js";
import type { UserAuthService } from "./user-auth.service.js";

export interface UserCookieConfig {
  // true in production: the cookie is sent over HTTPS only.
  secure: boolean;
}

// Named apart from the admin panel's cookie, so both panels can share one site.
export const USER_REFRESH_COOKIE = "userRefreshToken";
// The refresh cookie is only ever sent to the auth routes, never to the rest of the API.
const USER_REFRESH_COOKIE_PATH = "/api/v1/user/auth";

export class UserAuthController {
  constructor(
    private readonly userAuthService: UserAuthService,
    private readonly cookies: UserCookieConfig
  ) {}

  signInWithGoogle = async (req: Request, res: Response) => {
    const { idToken } = req.validated.body as UserGoogleSignInBody;
    const result = await this.userAuthService.signInWithGoogle(
      idToken,
      clientInfo(req)
    );

    this.setRefreshCookie(res, result);
    res
      .status(200)
      .json(new ApiResponse(200, this.toBody(result), "Signed in"));
  };

  refresh = async (req: Request, res: Response) => {
    const { refreshToken: fromBody } = req.validated.body as UserRefreshBody;
    const fromCookie = (req.cookies as Record<string, unknown>)[
      USER_REFRESH_COOKIE
    ];
    const refreshToken =
      typeof fromCookie === "string" && fromCookie ? fromCookie : fromBody;
    if (!refreshToken) throw ApiError.unauthorized("Invalid refresh token");

    try {
      const result = await this.userAuthService.refresh(
        refreshToken,
        clientInfo(req)
      );
      this.setRefreshCookie(res, result);
      res
        .status(200)
        .json(new ApiResponse(200, this.toBody(result), "Token refreshed"));
    } catch (err) {
      this.clearRefreshCookie(res);
      throw err;
    }
  };

  logout = async (req: Request, res: Response) => {
    if (!req.auth) throw ApiError.unauthorized();
    await this.userAuthService.logout(req.auth.sessionId);

    this.clearRefreshCookie(res);
    res.status(200).json(new ApiResponse(200, null, "Logged out"));
  };

  logoutAllDevices = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    await this.userAuthService.logoutAllDevices(req.user.id);

    this.clearRefreshCookie(res);
    res
      .status(200)
      .json(new ApiResponse(200, null, "Logged out of all devices"));
  };

  me = (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(200).json(new ApiResponse(200, req.user, "Profile fetched"));
  };

  updateProfile = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { name } = req.validated.body as UpdateUserProfileBody;
    const user = await this.userAuthService.updateName(req.user.id, name);
    res.status(200).json(new ApiResponse(200, user, "Profile updated"));
  };

  updateAvatar = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!req.file)
      throw ApiError.badRequest('Send the image in the "image" field');
    const user = await this.userAuthService.updateAvatar(
      req.user.id,
      req.file.path
    );
    res.status(200).json(new ApiResponse(200, user, "Photo updated"));
  };

  removeAvatar = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const user = await this.userAuthService.removeAvatar(req.user.id);
    res.status(200).json(new ApiResponse(200, user, "Photo removed"));
  };

  // ===========================================================================
  // Helpers
  // ===========================================================================

  // The refresh token is never put in the response body: the user panel is a web app, so it
  // lives only in an httpOnly cookie, where page scripts cannot read it.
  private toBody(result: UserSignInResult) {
    return { accessToken: result.accessToken, user: result.user };
  }

  private refreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cookies.secure,
      sameSite: "strict",
      path: USER_REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, result: UserSignInResult): void {
    res.cookie(USER_REFRESH_COOKIE, result.refreshToken, {
      ...this.refreshCookieOptions(),
      expires: result.refreshTokenExpiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(USER_REFRESH_COOKIE, this.refreshCookieOptions());
  }
}

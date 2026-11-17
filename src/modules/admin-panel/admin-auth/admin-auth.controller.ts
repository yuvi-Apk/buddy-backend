import type { CookieOptions, Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import { clientInfo } from "../../../utils/clientInfo.js";
import type {
  AdminGoogleSignInBody,
  AdminRefreshBody,
  AdminSignInResult,
} from "./admin-auth.schema.js";
import type { AdminAuthService } from "./admin-auth.service.js";

export interface AdminCookieConfig {
  // true in production: cookies are sent over HTTPS only.
  secure: boolean;
  accessTokenTtlMinutes: number;
}

export const ACCESS_COOKIE = "accessToken";
export const REFRESH_COOKIE = "refreshToken";
// The refresh cookie is only ever sent to the auth routes, never to the rest of the API.
const REFRESH_COOKIE_PATH = "/api/v1/admin/auth";

export class AdminAuthController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly cookies: AdminCookieConfig
  ) {}

  signInWithGoogle = async (req: Request, res: Response) => {
    const { idToken } = req.validated.body as AdminGoogleSignInBody;
    const result = await this.adminAuthService.signInWithGoogle(
      idToken,
      clientInfo(req)
    );

    this.setAuthCookies(res, result);
    res
      .status(200)
      .json(new ApiResponse(200, this.toBody(result), "Signed in"));
  };

  refresh = async (req: Request, res: Response) => {
    const { refreshToken: fromBody } = req.validated.body as AdminRefreshBody;
    const fromCookie = (req.cookies as Record<string, unknown>)[REFRESH_COOKIE];
    const refreshToken =
      typeof fromCookie === "string" && fromCookie ? fromCookie : fromBody;
    if (!refreshToken) throw ApiError.unauthorized("Invalid refresh token");

    try {
      const result = await this.adminAuthService.refresh(
        refreshToken,
        clientInfo(req)
      );
      this.setAuthCookies(res, result);
      res
        .status(200)
        .json(new ApiResponse(200, this.toBody(result), "Token refreshed"));
    } catch (err) {
      this.clearAuthCookies(res);
      throw err;
    }
  };

  logout = async (req: Request, res: Response) => {
    if (!req.auth) throw ApiError.unauthorized();
    await this.adminAuthService.logout(req.auth.sessionId);

    this.clearAuthCookies(res);
    res.status(200).json(new ApiResponse(200, null, "Logged out"));
  };

  me = async (req: Request, res: Response) => {
    if (!req.admin) throw ApiError.unauthorized();
    const pages = await this.adminAuthService.listAllowedPages(req.admin);
    const data = { ...req.admin, pages };
    res.status(200).json(new ApiResponse(200, data, "Profile fetched"));
  };

  // ===========================================================================
  // Helpers
  // ===========================================================================

  // The refresh token is never put in the response body: for the admin panel it lives only
  // in an httpOnly cookie, where page scripts cannot read it.
  private toBody(result: AdminSignInResult) {
    return { accessToken: result.accessToken, admin: result.admin };
  }

  private baseCookie(): CookieOptions {
    return { httpOnly: true, secure: this.cookies.secure, sameSite: "strict" };
  }

  private setAuthCookies(res: Response, result: AdminSignInResult): void {
    res.cookie(ACCESS_COOKIE, result.accessToken, {
      ...this.baseCookie(),
      path: "/",
      maxAge: this.cookies.accessTokenTtlMinutes * 60 * 1000,
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...this.baseCookie(),
      path: REFRESH_COOKIE_PATH,
      expires: result.refreshTokenExpiresAt,
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { ...this.baseCookie(), path: "/" });
    res.clearCookie(REFRESH_COOKIE, {
      ...this.baseCookie(),
      path: REFRESH_COOKIE_PATH,
    });
  }
}

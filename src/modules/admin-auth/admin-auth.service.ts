import type { Logger } from "pino";
import type { PageName } from "../../config/rbac.config.js";
import type { GoogleTokenVerifier } from "../../core/security/GoogleIdTokenVerifier.js";
import type { PermissionService } from "../../core/permissions/PermissionService.js";
import type { TokenService } from "../../core/security/TokenService.js";
import { ApiError } from "../../utils/ApiError.js";
import type {
  ClientInfo,
  IssuedSession,
  SessionService,
} from "../session/index.js";
import type { AdminAuthRepository } from "./admin-auth.repository.js";
import type {
  AdminSignInResult,
  AuthenticatedAdmin,
} from "./admin-auth.schema.js";

export class AdminAuthService {
  constructor(
    private readonly admins: AdminAuthRepository,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly google: GoogleTokenVerifier,
    private readonly permissions: PermissionService,
    private readonly logger: Logger
  ) {}

  // Only admins that already exist can sign in. A new sign-in ends the session on every
  // other device: one device at a time.
  async signInWithGoogle(
    idToken: string,
    client: ClientInfo
  ): Promise<AdminSignInResult> {
    // core-rules #14: one message for unknown, disabled and mismatched accounts.
    const failed = ApiError.unauthorized("Google sign-in failed");
    const identity = await this.google.verify(idToken);

    const account =
      (await this.admins.findForSignInByGoogleAccountId(
        identity.googleAccountId
      )) ?? (await this.admins.findForSignInByEmail(identity.email));
    if (!account?.isActive) throw failed;

    const isRecorded = await this.admins.recordSignIn({
      adminId: account.id,
      googleAccountId: identity.googleAccountId,
      avatarUrl: identity.avatarUrl,
    });
    if (!isRecorded) {
      // The email belongs to an admin linked to a different Google account.
      this.logger.warn(
        { adminId: account.id, ip: client.ip },
        "Admin sign-in with a different Google account"
      );
      throw failed;
    }

    const admin = await this.admins.findActiveProfile(account.id);
    if (!admin) throw failed;

    const session = await this.sessions.createSingleDevice(
      { type: "ADMIN", id: admin.id },
      client
    );
    return this.toResult(admin, session);
  }

  async refresh(
    refreshToken: string,
    client: ClientInfo
  ): Promise<AdminSignInResult> {
    const rotated = await this.sessions.rotate(refreshToken, "ADMIN", client);

    const admin = await this.admins.findActiveProfile(rotated.owner.id);
    if (!admin) {
      // Disabled after sign-in: end the session.
      await this.sessions.revoke(rotated.sessionId);
      throw ApiError.unauthorized("Invalid refresh token");
    }
    return this.toResult(admin, rotated);
  }

  logout(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId);
  }

  // Used by verifyAdmin on every request. Null when the account is missing or disabled.
  findAuthenticatedAdmin(adminId: string): Promise<AuthenticatedAdmin | null> {
    return this.admins.findActiveProfile(adminId);
  }

  // The admin panel uses this to decide which menu items to show.
  listAllowedPages(admin: AuthenticatedAdmin): Promise<PageName[]> {
    return this.permissions.allowedPages(admin.role);
  }

  private toResult(
    admin: AuthenticatedAdmin,
    session: IssuedSession
  ): AdminSignInResult {
    return {
      accessToken: this.tokens.signAdminAccessToken({
        adminId: admin.id,
        sessionId: session.sessionId,
      }),
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.expiresAt,
      admin,
    };
  }
}

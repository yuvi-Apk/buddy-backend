import type { Logger } from "pino";
import type { PageName } from "../../config/rbac.config.js";
import type { PermissionService } from "../../core/permissions/PermissionService.js";
import type { PasswordHasher } from "../../core/security/PasswordHasher.js";
import type { TokenService } from "../../core/security/TokenService.js";
import { ApiError } from "../../utils/ApiError.js";
import type { ClientInfo, SessionService } from "../session/index.js";
import type { AdminAuthRepository } from "./admin-auth.repository.js";
import type {
  AdminLoginBody,
  AdminLoginResult,
  AuthenticatedAdmin,
} from "./admin-auth.schema.js";

// After this many wrong passwords in a row the account is locked for a while (core-rules #13).
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export class AdminAuthService {
  // Hashed once, then reused to spend the same time on unknown emails as on known ones.
  private decoyHash?: Promise<string>;

  constructor(
    private readonly admins: AdminAuthRepository,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordHasher,
    private readonly permissions: PermissionService,
    private readonly logger: Logger
  ) {}

  async login(
    { email, password }: AdminLoginBody,
    client: ClientInfo
  ): Promise<AdminLoginResult> {
    // core-rules #14: one message for every failure, so nothing reveals whether the
    // email exists, the account is locked, or the account is disabled.
    const invalid = ApiError.unauthorized("Invalid email or password");

    const account = await this.admins.findWithPasswordHashByEmail(email);
    if (!account) {
      await this.passwords.verify(password, await this.getDecoyHash());
      throw invalid;
    }

    const isLocked =
      account.lockedUntil !== null && account.lockedUntil > new Date();
    const passwordOk = await this.passwords.verify(
      password,
      account.passwordHash
    );

    if (isLocked) {
      this.logger.warn(
        { adminUserId: account.id, ip: client.ip },
        "Login attempt on locked admin account"
      );
      throw invalid;
    }
    if (!passwordOk) {
      await this.admins.recordFailedLogin(
        account.id,
        MAX_FAILED_LOGINS,
        new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
      );
      throw invalid;
    }

    const admin = await this.admins.findActiveProfile(account.id);
    if (!admin) throw invalid; // disabled account

    await this.admins.clearFailedLogins(account.id);
    const session = await this.sessions.create(
      { type: "ADMIN", id: admin.id },
      client
    );

    return {
      accessToken: this.tokens.signAdminAccessToken({
        adminUserId: admin.id,
        sessionId: session.sessionId,
      }),
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.expiresAt,
      admin,
    };
  }

  async refresh(
    refreshToken: string,
    client: ClientInfo
  ): Promise<AdminLoginResult> {
    const rotated = await this.sessions.rotate(refreshToken, "ADMIN", client);

    const admin = await this.admins.findActiveProfile(rotated.subject.id);
    if (!admin) {
      // The account was disabled after login: end the session.
      await this.sessions.revoke(rotated.sessionId);
      throw ApiError.unauthorized("Invalid refresh token");
    }

    return {
      accessToken: this.tokens.signAdminAccessToken({
        adminUserId: admin.id,
        sessionId: rotated.sessionId,
      }),
      refreshToken: rotated.refreshToken,
      refreshTokenExpiresAt: rotated.expiresAt,
      admin,
    };
  }

  logout(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId);
  }

  /** Used by verifyAdmin on every request. Null when the account is missing or disabled. */
  getAuthenticatedAdmin(
    adminUserId: string
  ): Promise<AuthenticatedAdmin | null> {
    return this.admins.findActiveProfile(adminUserId);
  }

  /** The admin panel uses this to decide which menu items to show. */
  allowedPages(admin: AuthenticatedAdmin): Promise<PageName[]> {
    return this.permissions.allowedPages(admin.role);
  }

  private getDecoyHash(): Promise<string> {
    this.decoyHash ??= this.passwords.hash("decoy-password-for-timing");
    return this.decoyHash;
  }
}

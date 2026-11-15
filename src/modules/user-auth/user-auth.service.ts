import type { OtpSender } from "../../core/otp/OtpSender.js";
import type { OtpService } from "../../core/otp/OtpService.js";
import type { TokenService } from "../../core/security/TokenService.js";
import { ApiError } from "../../utils/ApiError.js";
import type { ClientInfo, IssuedSession } from "../session/session.schema.js";
import type { SessionService } from "../session/session.service.js";
import type { UserAuthRepository } from "./user-auth.repository.js";
import type {
  AuthenticatedUser,
  UserLoginResult,
  VerifyOtpBody,
} from "./user-auth.schema.js";

export class UserAuthService {
  constructor(
    private readonly users: UserAuthRepository,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly otpSender: OtpSender
  ) {}

  /** Sends a login code. The account itself is only created once the code is verified. */
  async requestOtp(phone: string): Promise<void> {
    const code = await this.otp.issue(phone);
    await this.otpSender.send(phone, code);
  }

  async verifyOtp(
    { phone, otp }: VerifyOtpBody,
    client: ClientInfo
  ): Promise<UserLoginResult> {
    // RULES.md #14: one message for a wrong code, an expired code and a disabled account.
    const invalid = ApiError.unauthorized("Invalid or expired code");

    if (!(await this.otp.verify(phone, otp))) throw invalid;

    const { isActive, ...user } = await this.users.findOrCreateByPhone(phone);
    if (!isActive) throw invalid;

    const session = await this.sessions.create(
      { type: "USER", id: user.id },
      client
    );
    return this.toResult(user, session);
  }

  async refresh(
    refreshToken: string,
    client: ClientInfo
  ): Promise<UserLoginResult> {
    const rotated = await this.sessions.rotate(refreshToken, "USER", client);

    const user = await this.users.findActiveProfile(rotated.subject.id);
    if (!user) {
      // The account was disabled after login: end the session.
      await this.sessions.revoke(rotated.sessionId);
      throw ApiError.unauthorized("Invalid refresh token");
    }
    return this.toResult(user, rotated);
  }

  logout(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId);
  }

  /** Used by verifyUser on every request. Null when the account is missing or disabled. */
  getAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    return this.users.findActiveProfile(userId);
  }

  private toResult(
    user: AuthenticatedUser,
    session: IssuedSession
  ): UserLoginResult {
    return {
      accessToken: this.tokens.signUserAccessToken({
        userId: user.id,
        sessionId: session.sessionId,
      }),
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.expiresAt,
      user,
    };
  }
}

import type { GoogleTokenVerifier } from "../../core/security/GoogleIdTokenVerifier.js";
import type { TokenService } from "../../core/security/TokenService.js";
import { ApiError } from "../../utils/ApiError.js";
import type {
  ClientInfo,
  IssuedSession,
  SessionService,
} from "../session/index.js";
import type { UserAuthRepository } from "./user-auth.repository.js";
import type {
  AuthenticatedUser,
  UserSignInResult,
} from "./user-auth.schema.js";

export class UserAuthService {
  constructor(
    private readonly users: UserAuthRepository,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly google: GoogleTokenVerifier
  ) {}

  // Creates the account on first sign-in. Other devices stay signed in.
  async signInWithGoogle(
    idToken: string,
    client: ClientInfo
  ): Promise<UserSignInResult> {
    const identity = await this.google.verify(idToken);

    const { isActive, ...user } = await this.users.upsertFromGoogle(identity);
    // core-rules #14: same message as a bad token.
    if (!isActive) throw ApiError.unauthorized("Google sign-in failed");

    const session = await this.sessions.create(
      { type: "USER", id: user.id },
      client
    );
    return this.toResult(user, session);
  }

  async refresh(
    refreshToken: string,
    client: ClientInfo
  ): Promise<UserSignInResult> {
    const rotated = await this.sessions.rotate(refreshToken, "USER", client);

    const user = await this.users.findActiveProfile(rotated.owner.id);
    if (!user) {
      // Disabled after sign-in: end the session.
      await this.sessions.revoke(rotated.sessionId);
      throw ApiError.unauthorized("Invalid refresh token");
    }
    return this.toResult(user, rotated);
  }

  logout(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId);
  }

  logoutAllDevices(userId: string): Promise<void> {
    return this.sessions.revokeAllForOwner({ type: "USER", id: userId });
  }

  // Used by verifyUser on every request. Null when the account is missing or disabled.
  findAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    return this.users.findActiveProfile(userId);
  }

  // Used by the organization module to add an existing user by email.
  findActiveUserIdByEmail(email: string): Promise<string | null> {
    return this.users.findActiveUserIdByEmail(email.toLowerCase());
  }

  private toResult(
    user: AuthenticatedUser,
    session: IssuedSession
  ): UserSignInResult {
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

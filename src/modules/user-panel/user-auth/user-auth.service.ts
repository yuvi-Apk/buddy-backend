import { PUBLIC_IMAGES_URL } from "../../../config/upload.config.js";
import type { GoogleTokenVerifier } from "../../../core/security/GoogleIdTokenVerifier.js";
import type { TokenService } from "../../../core/security/TokenService.js";
import type { StorageProvider } from "../../../core/storage/StorageProvider.js";
import { ApiError } from "../../../utils/ApiError.js";
import { uploadAndCompressImage } from "../../../utils/uploadAndCompressImage.js";
import type {
  ClientInfo,
  IssuedSession,
  SessionService,
} from "../../shared/session/index.js";
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
    private readonly google: GoogleTokenVerifier,
    private readonly storage: StorageProvider
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

  // ===========================================================================
  // Own profile
  // ===========================================================================

  updateName(userId: string, name: string): Promise<AuthenticatedUser> {
    return this.users.updateName(userId, name);
  }

  // Compresses the image multer saved at tempPath and makes it the user's photo.
  async updateAvatar(
    userId: string,
    tempPath: string
  ): Promise<AuthenticatedUser> {
    const previousAvatarUrl = await this.users.findAvatarUrl(userId);
    const image = await uploadAndCompressImage(
      tempPath,
      { uploadFolder: "profile" },
      this.storage
    );
    return this.swapAvatar(userId, previousAvatarUrl, image.url);
  }

  async removeAvatar(userId: string): Promise<AuthenticatedUser> {
    const previousAvatarUrl = await this.users.findAvatarUrl(userId);
    return this.swapAvatar(userId, previousAvatarUrl, null);
  }

  private async swapAvatar(
    userId: string,
    previousAvatarUrl: string | null,
    nextAvatarUrl: string | null
  ): Promise<AuthenticatedUser> {
    let isReplaced: boolean;
    try {
      isReplaced = await this.users.replaceAvatarUrl(
        userId,
        previousAvatarUrl,
        nextAvatarUrl
      );
    } catch (err) {
      await this.deleteStoredAvatar(nextAvatarUrl);
      throw err;
    }
    if (!isReplaced) {
      // Another change won the race: drop this file, keep theirs.
      await this.deleteStoredAvatar(nextAvatarUrl);
      throw ApiError.conflict(
        "Your photo was changed at the same time. Try again."
      );
    }

    await this.deleteStoredAvatar(previousAvatarUrl);
    const user = await this.users.findActiveProfile(userId);
    if (!user) throw ApiError.unauthorized();
    return user;
  }

  // Only files this app stored are deleted. A Google photo URL is left alone.
  private async deleteStoredAvatar(avatarUrl: string | null): Promise<void> {
    if (avatarUrl?.startsWith(`${PUBLIC_IMAGES_URL}/profile/`)) {
      await this.storage.delete(avatarUrl);
    }
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

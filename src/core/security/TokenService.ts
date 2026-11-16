// Creates and checks tokens.
//
// Access token:  a JWT, valid for a few minutes, sent on every request.
// Refresh token: a random value, valid for days, used only to get a new access token.
//                Format "<sessionId>.<random>". Only its SHA-256 hash is stored (core-rules #12).
//
// Admin and user access tokens use different secrets and audiences, so a user token can
// never be accepted on an admin route.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type {
  AdminJwtPayload,
  UserJwtPayload,
} from "../../types/jwt.payload.type.js";
import { ApiError } from "../../utils/ApiError.js";

export interface TokenConfig {
  adminSecret: string;
  userSecret: string;
  accessTokenTtlMinutes: number;
}

const ISSUER = "buddy-api";
// Pinned so a token signed with another algorithm (or "none") is always rejected.
const ALGORITHM = "HS256";

const adminPayloadSchema = z.object({
  adminId: z.uuid(),
  sessionId: z.uuid(),
});
const userPayloadSchema = z.object({
  userId: z.uuid(),
  sessionId: z.uuid(),
});

export class TokenService {
  constructor(private readonly config: TokenConfig) {}

  // --- access tokens --------------------------------------------------------

  signAdminAccessToken(payload: AdminJwtPayload): string {
    return this.sign(payload, this.config.adminSecret, "admin");
  }

  signUserAccessToken(payload: UserJwtPayload): string {
    return this.sign(payload, this.config.userSecret, "user");
  }

  // Throws a 401 ApiError when the token is missing, expired, forged or of the wrong kind.
  verifyAdminAccessToken(token: string): AdminJwtPayload {
    return this.verify(
      token,
      this.config.adminSecret,
      "admin",
      adminPayloadSchema
    );
  }

  verifyUserAccessToken(token: string): UserJwtPayload {
    return this.verify(
      token,
      this.config.userSecret,
      "user",
      userPayloadSchema
    );
  }

  // --- refresh tokens -------------------------------------------------------

  generateRefreshToken(sessionId: string): string {
    return `${sessionId}.${randomBytes(32).toString("base64url")}`;
  }

  // Returns the session ID inside a refresh token, or null when the format is wrong.
  sessionIdFromRefreshToken(token: string): string | null {
    const [sessionId, secret, ...rest] = token.split(".");
    const wellFormed =
      rest.length === 0 && !!secret && z.uuid().safeParse(sessionId).success;
    return wellFormed ? sessionId! : null;
  }

  hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  // Constant-time comparison of two hashes.
  hashesMatch(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  // --- internals ------------------------------------------------------------

  private sign(payload: object, secret: string, audience: string): string {
    return jwt.sign(payload, secret, {
      algorithm: ALGORITHM,
      expiresIn: this.config.accessTokenTtlMinutes * 60,
      audience,
      issuer: ISSUER,
    });
  }

  private verify<T>(
    token: string,
    secret: string,
    audience: string,
    schema: z.ZodType<T>
  ): T {
    let decoded: unknown;
    try {
      decoded = jwt.verify(token, secret, {
        algorithms: [ALGORITHM],
        audience,
        issuer: ISSUER,
      });
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw ApiError.unauthorized("Token expired");
      }
      throw ApiError.unauthorized("Invalid token");
    }

    const payload = schema.safeParse(decoded);
    if (!payload.success) {
      throw ApiError.unauthorized("Invalid token");
    }
    return payload.data;
  }
}

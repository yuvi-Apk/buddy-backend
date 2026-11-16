// Sessions: one per login. This is what makes logout immediate (core-rules #4):
// every request checks that its session is still active.
//
// Postgres is the source of truth. Redis holds a short-lived copy ("session:<id>") so the
// per-request check is fast. Revoking deletes the Redis copy at once.
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { Redis } from "../../config/redis.js";
import type { TokenService } from "../../core/security/TokenService.js";
import { ApiError } from "../../utils/ApiError.js";
import type { SessionRepository } from "./session.repository.js";
import type {
  ClientInfo,
  IssuedSession,
  Subject,
  SubjectType,
} from "./session.schema.js";

export interface SessionConfig {
  refreshTokenTtlDays: number;
}

// How long an "active" answer may be served from Redis before Postgres is asked again.
const CACHE_TTL_SECONDS = 10 * 60;
const cacheKey = (sessionId: string) => `session:${sessionId}`;
const cacheValue = (subject: Subject) => `${subject.type}:${subject.id}`;

export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly config: SessionConfig
  ) {}

  // Starts a session after a successful login.
  async create(subject: Subject, client: ClientInfo): Promise<IssuedSession> {
    const sessionId = randomUUID();
    const refreshToken = this.tokens.generateRefreshToken(sessionId);
    const expiresAt = this.newExpiry();

    await this.sessions.create({
      id: sessionId,
      subject,
      refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
      expiresAt,
      client,
    });
    await this.cache(sessionId, subject);

    return { sessionId, refreshToken, expiresAt };
  }

  // True when the session exists, is not revoked or expired, and belongs to this subject.
  async isActive(sessionId: string, subject: Subject): Promise<boolean> {
    const expected = cacheValue(subject);

    const cached = await this.readCache(sessionId);
    if (cached !== null) {
      return cached === expected;
    }

    // Not in Redis (expired copy, or Redis is down): ask Postgres.
    const owner = await this.sessions.findActiveSubject(sessionId);
    if (!owner) {
      return false;
    }
    await this.cache(sessionId, owner);
    return cacheValue(owner) === expected;
  }

  // Exchanges a refresh token for a new one. Each refresh token works once.
  // If an already-used token shows up again, someone may have stolen it, so the whole
  // session is revoked and both parties have to log in again.
  async rotate(
    refreshToken: string,
    subjectType: SubjectType,
    client: ClientInfo
  ): Promise<IssuedSession & { subject: Subject }> {
    const invalid = ApiError.unauthorized("Invalid refresh token");

    const sessionId = this.tokens.sessionIdFromRefreshToken(refreshToken);
    if (!sessionId) throw invalid;

    const presentedHash = this.tokens.hashRefreshToken(refreshToken);
    const newRefreshToken = this.tokens.generateRefreshToken(sessionId);
    const expiresAt = this.newExpiry();

    const rotated = await this.sessions.rotateRefreshToken({
      id: sessionId,
      subjectType,
      currentHash: presentedHash,
      newHash: this.tokens.hashRefreshToken(newRefreshToken),
      newExpiresAt: expiresAt,
    });

    if (!rotated) {
      await this.revokeIfTokenWasReused(sessionId, presentedHash, client);
      throw invalid;
    }

    const subject = await this.sessions.findActiveSubject(sessionId);
    if (!subject) throw invalid;

    return { sessionId, refreshToken: newRefreshToken, expiresAt, subject };
  }

  // Logout: the session stops working on the very next request.
  async revoke(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.redis.del(cacheKey(sessionId));
  }

  // Logout everywhere, for example after a password change or when an account is disabled.
  async revokeAllForSubject(subject: Subject): Promise<void> {
    const ids = await this.sessions.revokeAllForSubject(subject);
    if (ids.length > 0) {
      await this.redis.del(...ids.map(cacheKey));
    }
  }

  listForSubject(subject: Subject) {
    return this.sessions.listActiveForSubject(subject);
  }

  // Revokes one session, but only if it belongs to the caller (core-rules #8).
  async revokeOwned(sessionId: string, subject: Subject): Promise<void> {
    const owner = await this.sessions.findActiveSubject(sessionId);
    const isOwner =
      owner !== null && owner.type === subject.type && owner.id === subject.id;
    if (!isOwner) {
      // 404, not 403: do not reveal that someone else's session exists.
      throw ApiError.notFound("Session not found");
    }
    await this.revoke(sessionId);
  }

  // --- internals ------------------------------------------------------------

  private newExpiry(): Date {
    const dayMs = 24 * 60 * 60 * 1000;
    return new Date(Date.now() + this.config.refreshTokenTtlDays * dayMs);
  }

  private async revokeIfTokenWasReused(
    sessionId: string,
    presentedHash: string,
    client: ClientInfo
  ): Promise<void> {
    const previousHash = await this.sessions.findPreviousTokenHash(sessionId);
    if (previousHash && this.tokens.hashesMatch(previousHash, presentedHash)) {
      await this.revoke(sessionId);
      this.logger.warn(
        { sessionId, ip: client.ip },
        "Refresh token reuse detected, session revoked"
      );
    }
  }

  private async cache(sessionId: string, subject: Subject): Promise<void> {
    try {
      await this.redis.set(
        cacheKey(sessionId),
        cacheValue(subject),
        "EX",
        CACHE_TTL_SECONDS
      );
    } catch {
      // Redis is only a cache here. Postgres still has the session.
    }
  }

  private async readCache(sessionId: string): Promise<string | null> {
    try {
      return await this.redis.get(cacheKey(sessionId));
    } catch {
      return null; // Fall back to Postgres.
    }
  }
}

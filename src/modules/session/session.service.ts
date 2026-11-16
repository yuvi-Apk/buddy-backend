// Sessions: one per sign-in on one device. This is what makes logout immediate (core-rules #4):
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
  SessionDto,
  SessionOwner,
  SessionOwnerType,
} from "./session.schema.js";

export interface SessionConfig {
  refreshTokenTtlDays: number;
}

// How long an "active" answer may be served from Redis before Postgres is asked again.
const CACHE_TTL_SECONDS = 10 * 60;
const cacheKey = (sessionId: string) => `session:${sessionId}`;
const cacheValue = (owner: SessionOwner) => `${owner.type}:${owner.id}`;

export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly config: SessionConfig
  ) {}

  // Starts a session after a successful sign-in. Other devices stay signed in.
  async create(
    owner: SessionOwner,
    client: ClientInfo
  ): Promise<IssuedSession> {
    const issued = this.issue();
    await this.sessions.create(this.toNewSession(issued, owner, client));
    await this.cache(issued.sessionId, owner);
    return issued;
  }

  // Starts a session and ends every other session of the owner: one device at a time.
  async createSingleDevice(
    owner: SessionOwner,
    client: ClientInfo
  ): Promise<IssuedSession> {
    const issued = this.issue();
    const revokedIds = await this.sessions.replaceAllForOwner(
      this.toNewSession(issued, owner, client)
    );
    await this.uncache(revokedIds);
    await this.cache(issued.sessionId, owner);
    return issued;
  }

  // True when the session exists, is not revoked or expired, and belongs to this owner.
  async isActive(sessionId: string, owner: SessionOwner): Promise<boolean> {
    const expected = cacheValue(owner);

    const cached = await this.readCache(sessionId);
    if (cached !== null) return cached === expected;

    // Not in Redis (expired copy, or Redis is down): ask Postgres.
    const actualOwner = await this.sessions.findActiveOwner(sessionId);
    if (!actualOwner) return false;
    await this.cache(sessionId, actualOwner);
    return cacheValue(actualOwner) === expected;
  }

  // Exchanges a refresh token for a new one. Each refresh token works once.
  // A reused token may be stolen, so the whole session is revoked.
  async rotate(
    refreshToken: string,
    ownerType: SessionOwnerType,
    client: ClientInfo
  ): Promise<IssuedSession & { owner: SessionOwner }> {
    const invalid = ApiError.unauthorized("Invalid refresh token");

    const sessionId = this.tokens.sessionIdFromRefreshToken(refreshToken);
    if (!sessionId) throw invalid;

    const presentedHash = this.tokens.hashRefreshToken(refreshToken);
    const newRefreshToken = this.tokens.generateRefreshToken(sessionId);
    const expiresAt = this.newExpiry();

    const isRotated = await this.sessions.rotateRefreshToken({
      id: sessionId,
      ownerType,
      currentHash: presentedHash,
      newHash: this.tokens.hashRefreshToken(newRefreshToken),
      newExpiresAt: expiresAt,
    });
    if (!isRotated) {
      await this.revokeIfTokenWasReused(sessionId, presentedHash, client);
      throw invalid;
    }

    const owner = await this.sessions.findActiveOwner(sessionId);
    if (!owner) throw invalid;

    return { sessionId, refreshToken: newRefreshToken, expiresAt, owner };
  }

  // Logout: the session stops working on the very next request.
  async revoke(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.uncache([sessionId]);
  }

  // Logout everywhere: "log out all devices", or when an account is disabled.
  async revokeAllForOwner(owner: SessionOwner): Promise<void> {
    await this.uncache(await this.sessions.revokeAllForOwner(owner));
  }

  listForOwner(owner: SessionOwner): Promise<SessionDto[]> {
    return this.sessions.listActiveForOwner(owner);
  }

  // Revokes one session, but only if it belongs to the caller (core-rules #8).
  async revokeOwned(sessionId: string, owner: SessionOwner): Promise<void> {
    const actualOwner = await this.sessions.findActiveOwner(sessionId);
    const isOwner =
      actualOwner?.type === owner.type && actualOwner.id === owner.id;
    // 404, not 403: don't reveal that someone else's session exists.
    if (!isOwner) throw ApiError.notFound("Session not found");
    await this.revoke(sessionId);
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private issue(): IssuedSession {
    const sessionId = randomUUID();
    return {
      sessionId,
      refreshToken: this.tokens.generateRefreshToken(sessionId),
      expiresAt: this.newExpiry(),
    };
  }

  private toNewSession(
    issued: IssuedSession,
    owner: SessionOwner,
    client: ClientInfo
  ) {
    return {
      id: issued.sessionId,
      owner,
      refreshTokenHash: this.tokens.hashRefreshToken(issued.refreshToken),
      expiresAt: issued.expiresAt,
      client,
    };
  }

  private newExpiry(): Date {
    const dayMs = 24 * 60 * 60 * 1000;
    return new Date(Date.now() + this.config.refreshTokenTtlDays * dayMs);
  }

  private async revokeIfTokenWasReused(
    sessionId: string,
    presentedHash: string,
    client: ClientInfo
  ): Promise<void> {
    const previousHash =
      await this.sessions.findPreviousRefreshTokenHash(sessionId);
    if (previousHash && this.tokens.hashesMatch(previousHash, presentedHash)) {
      await this.revoke(sessionId);
      this.logger.warn(
        { sessionId, ip: client.ip },
        "Refresh token reuse detected, session revoked"
      );
    }
  }

  private async cache(sessionId: string, owner: SessionOwner): Promise<void> {
    try {
      await this.redis.set(
        cacheKey(sessionId),
        cacheValue(owner),
        "EX",
        CACHE_TTL_SECONDS
      );
    } catch {
      // Redis is only a cache here. Postgres still has the session.
    }
  }

  private async uncache(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    await this.redis.del(...sessionIds.map(cacheKey));
  }

  private async readCache(sessionId: string): Promise<string | null> {
    try {
      return await this.redis.get(cacheKey(sessionId));
    } catch {
      return null; // fall back to Postgres
    }
  }
}

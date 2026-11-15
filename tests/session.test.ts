import jwt from "jsonwebtoken";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TokenService } from "../src/core/security/TokenService.js";
import type { Subject } from "../src/modules/session/session.schema.js";
import { createAdmin, createUser } from "./helpers/fixtures.js";
import {
  closeTestApp,
  container,
  prisma,
  redis,
  resetState,
} from "./helpers/testApp.js";

const { tokenService } = container;
const sessionService = container.modules.session.service;
const client = { userAgent: "vitest", ip: "127.0.0.1" };

let adminSubject: Subject;

beforeEach(async () => {
  await resetState();
  const { admin } = await createAdmin();
  adminSubject = { type: "ADMIN", id: admin.id };
});
afterAll(closeTestApp);

describe("TokenService", () => {
  const ids = {
    adminUserId: "3f2b8c1e-6d4a-4e9b-9c1f-2a7d5e8b0c11",
    sessionId: "9a1c7e52-0b3d-4f6a-8e2c-5d4b3a2f1e00",
  };

  it("signs and verifies an admin access token", () => {
    const token = tokenService.signAdminAccessToken(ids);
    expect(tokenService.verifyAdminAccessToken(token)).toEqual(ids);
  });

  it("never accepts a user token as an admin token, or the reverse", () => {
    const userToken = tokenService.signUserAccessToken({
      userId: ids.adminUserId,
      sessionId: ids.sessionId,
    });
    expect(() => tokenService.verifyAdminAccessToken(userToken)).toThrow(
      "Invalid token"
    );

    const adminToken = tokenService.signAdminAccessToken(ids);
    expect(() => tokenService.verifyUserAccessToken(adminToken)).toThrow(
      "Invalid token"
    );
  });

  it("rejects tampered, unsigned and wrong-algorithm tokens", () => {
    const token = tokenService.signAdminAccessToken(ids);
    expect(() => tokenService.verifyAdminAccessToken(token + "x")).toThrow(
      "Invalid token"
    );

    const unsigned = jwt.sign(ids, "", {
      algorithm: "none",
      audience: "admin",
      issuer: "buddy-api",
    });
    expect(() => tokenService.verifyAdminAccessToken(unsigned)).toThrow(
      "Invalid token"
    );

    const otherAlgorithm = jwt.sign(
      ids,
      "test-only-admin-access-token-secret-0000000000",
      { algorithm: "HS512", audience: "admin", issuer: "buddy-api" }
    );
    expect(() => tokenService.verifyAdminAccessToken(otherAlgorithm)).toThrow(
      "Invalid token"
    );
  });

  it("rejects an expired token with a distinct message", () => {
    const shortLived = new TokenService({
      adminSecret: "a".repeat(40),
      userSecret: "b".repeat(40),
      accessTokenTtlMinutes: -1,
    });
    const token = shortLived.signAdminAccessToken(ids);
    expect(() => shortLived.verifyAdminAccessToken(token)).toThrow(
      "Token expired"
    );
  });

  it("rejects a token whose payload has the wrong shape", () => {
    const token = jwt.sign(
      { adminUserId: "not-a-uuid", sessionId: ids.sessionId },
      "test-only-admin-access-token-secret-0000000000",
      { algorithm: "HS256", audience: "admin", issuer: "buddy-api" }
    );
    expect(() => tokenService.verifyAdminAccessToken(token)).toThrow(
      "Invalid token"
    );
  });
});

describe("SessionService", () => {
  it("creates an active session and stores only a hash of the refresh token", async () => {
    const issued = await sessionService.create(adminSubject, client);

    expect(await sessionService.isActive(issued.sessionId, adminSubject)).toBe(
      true
    );
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(row.refreshTokenHash).not.toBe(issued.refreshToken);
    expect(JSON.stringify(row)).not.toContain(issued.refreshToken);
  });

  it("stops being active the moment it is revoked (logout)", async () => {
    const issued = await sessionService.create(adminSubject, client);
    await sessionService.revoke(issued.sessionId);
    expect(await sessionService.isActive(issued.sessionId, adminSubject)).toBe(
      false
    );
  });

  it("is not active for a different subject", async () => {
    const issued = await sessionService.create(adminSubject, client);
    const user = await createUser();
    expect(
      await sessionService.isActive(issued.sessionId, {
        type: "USER",
        id: user.id,
      })
    ).toBe(false);
    expect(
      await sessionService.isActive(issued.sessionId, {
        type: "USER",
        id: adminSubject.id,
      })
    ).toBe(false);
  });

  it("falls back to Postgres when the Redis copy is gone", async () => {
    const issued = await sessionService.create(adminSubject, client);
    await redis.flushdb();
    expect(await sessionService.isActive(issued.sessionId, adminSubject)).toBe(
      true
    );
    // ...and a revoked session stays inactive without the Redis copy too.
    await sessionService.revoke(issued.sessionId);
    await redis.flushdb();
    expect(await sessionService.isActive(issued.sessionId, adminSubject)).toBe(
      false
    );
  });

  it("treats an expired session as inactive", async () => {
    const issued = await sessionService.create(adminSubject, client);
    await prisma.session.update({
      where: { id: issued.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await redis.flushdb();
    expect(await sessionService.isActive(issued.sessionId, adminSubject)).toBe(
      false
    );
  });

  it("rotates the refresh token; the old one stops working", async () => {
    const issued = await sessionService.create(adminSubject, client);
    const rotated = await sessionService.rotate(
      issued.refreshToken,
      "ADMIN",
      client
    );

    expect(rotated.sessionId).toBe(issued.sessionId);
    expect(rotated.subject).toEqual(adminSubject);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);

    const again = await sessionService.rotate(
      rotated.refreshToken,
      "ADMIN",
      client
    );
    expect(again.refreshToken).not.toBe(rotated.refreshToken);
  });

  it("revokes the whole session when a used refresh token is presented again", async () => {
    const issued = await sessionService.create(adminSubject, client);
    const rotated = await sessionService.rotate(
      issued.refreshToken,
      "ADMIN",
      client
    );

    // The old token comes back: possible theft.
    await expect(
      sessionService.rotate(issued.refreshToken, "ADMIN", client)
    ).rejects.toThrow("Invalid refresh token");

    // The newest token is now dead as well, and the session is inactive.
    await expect(
      sessionService.rotate(rotated.refreshToken, "ADMIN", client)
    ).rejects.toThrow("Invalid refresh token");
    expect(await sessionService.isActive(issued.sessionId, adminSubject)).toBe(
      false
    );
  });

  it("lets only one of two parallel refreshes with the same token succeed", async () => {
    const issued = await sessionService.create(adminSubject, client);
    const results = await Promise.allSettled([
      sessionService.rotate(issued.refreshToken, "ADMIN", client),
      sessionService.rotate(issued.refreshToken, "ADMIN", client),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("rejects malformed tokens, unknown sessions and the wrong subject type", async () => {
    const issued = await sessionService.create(adminSubject, client);
    const attempts = [
      sessionService.rotate("garbage", "ADMIN", client),
      sessionService.rotate(
        "9a1c7e52-0b3d-4f6a-8e2c-5d4b3a2f1e00.abc",
        "ADMIN",
        client
      ),
      sessionService.rotate(issued.refreshToken, "USER", client),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toThrow("Invalid refresh token");
    }
    // A wrong-type attempt must not disturb the real session.
    expect(await sessionService.isActive(issued.sessionId, adminSubject)).toBe(
      true
    );
  });

  it("revokes all sessions of a subject at once", async () => {
    const first = await sessionService.create(adminSubject, client);
    const second = await sessionService.create(adminSubject, client);
    await sessionService.revokeAllForSubject(adminSubject);
    expect(await sessionService.isActive(first.sessionId, adminSubject)).toBe(
      false
    );
    expect(await sessionService.isActive(second.sessionId, adminSubject)).toBe(
      false
    );
  });

  it("lets a subject revoke only their own session", async () => {
    const mine = await sessionService.create(adminSubject, client);
    const { admin: other } = await createAdmin();
    const otherSubject: Subject = { type: "ADMIN", id: other.id };

    await expect(
      sessionService.revokeOwned(mine.sessionId, otherSubject)
    ).rejects.toThrow("Session not found");
    expect(await sessionService.isActive(mine.sessionId, adminSubject)).toBe(
      true
    );

    await sessionService.revokeOwned(mine.sessionId, adminSubject);
    expect(await sessionService.isActive(mine.sessionId, adminSubject)).toBe(
      false
    );
  });

  it("lists sessions without any token hash", async () => {
    await sessionService.create(adminSubject, client);
    const sessions = await sessionService.listForSubject(adminSubject);
    expect(sessions).toHaveLength(1);
    expect(Object.keys(sessions[0]!)).not.toContain("refreshTokenHash");
    expect(Object.keys(sessions[0]!)).not.toContain("previousRefreshTokenHash");
  });
});

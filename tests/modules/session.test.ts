// Sessions and tokens: the TokenService and SessionService classes, then the two session
// endpoints (/admin/sessions and /user/sessions), one describe block per endpoint.
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TokenService } from "../../src/core/security/TokenService.js";
import type { Subject } from "../../src/modules/session/index.js";
import { bearer, loginAdmin, loginUser, TEST_PHONE } from "../helpers/auth.js";
import { createAdmin, createUser } from "../helpers/fixtures.js";
import {
  expectLoginRequired,
  MISSING_ID,
  type Route,
} from "../helpers/guards.js";
import {
  app,
  closeTestApp,
  container,
  prisma,
  redis,
  resetState,
} from "../helpers/testApp.js";

const ADMIN_SESSIONS = "/api/v1/admin/sessions";
const USER_SESSIONS = "/api/v1/user/sessions";
const ADMIN_ME = "/api/v1/admin/auth/me";

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

/** Logs in an admin and returns the access token. */
const adminToken = async (email: string) =>
  (await loginAdmin(email)).body.data.accessToken as string;

describe("GET /admin/sessions", () => {
  it("401 without an admin login", async () => {
    const routes: Route[] = [
      ["get", ADMIN_SESSIONS],
      ["delete", `${ADMIN_SESSIONS}/${MISSING_ID}`],
    ];
    await expectLoginRequired(routes);
  });

  it("200 lists only the caller's own sessions, marks the current one, and hides hashes", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await createAdmin({ email: "other@buddy.test" });
    const token = await adminToken("head@buddy.test");
    await loginAdmin("head@buddy.test");
    await loginAdmin("other@buddy.test");

    const res = await request(app).get(ADMIN_SESSIONS).set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(
      res.body.data.filter((s: { isCurrent: boolean }) => s.isCurrent)
    ).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/TokenHash/);
  });
});

describe("DELETE /admin/sessions/:id", () => {
  it("400 for a malformed ID", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const token = await adminToken("head@buddy.test");
    const res = await request(app)
      .delete(`${ADMIN_SESSIONS}/not-a-uuid`)
      .set(bearer(token));
    expect(res.status).toBe(400);
  });

  it("404 for another admin's session, which keeps working", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await createAdmin({ email: "other@buddy.test" });
    const mine = await adminToken("head@buddy.test");
    const theirs = await adminToken("other@buddy.test");

    const theirSessions = await request(app)
      .get(ADMIN_SESSIONS)
      .set(bearer(theirs));
    const theirSessionId = theirSessions.body.data[0].id as string;

    const attempt = await request(app)
      .delete(`${ADMIN_SESSIONS}/${theirSessionId}`)
      .set(bearer(mine));
    expect(attempt.status).toBe(404);

    expect((await request(app).get(ADMIN_ME).set(bearer(theirs))).status).toBe(
      200
    );
  });

  it("200 revokes one of the caller's own sessions", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const laptop = await adminToken("head@buddy.test");
    const phone = await adminToken("head@buddy.test");

    const list = await request(app).get(ADMIN_SESSIONS).set(bearer(laptop));
    const phoneSession = list.body.data.find(
      (s: { isCurrent: boolean }) => !s.isCurrent
    );

    const res = await request(app)
      .delete(`${ADMIN_SESSIONS}/${phoneSession.id}`)
      .set(bearer(laptop));
    expect(res.status).toBe(200);

    expect((await request(app).get(ADMIN_ME).set(bearer(phone))).status).toBe(
      401
    );
  });
});

describe("GET /user/sessions", () => {
  it("401 without a user login", async () => {
    expect((await request(app).get(USER_SESSIONS)).status).toBe(401);
  });

  it("200 lists the user's own sessions and marks the current one", async () => {
    const { auth } = await loginUser();
    const list = await request(app).get(USER_SESSIONS).set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].isCurrent).toBe(true);
  });
});

describe("DELETE /user/sessions/:id", () => {
  it("404 for another user's session", async () => {
    const me = await loginUser(TEST_PHONE);
    const other = await loginUser("+919800000077");
    const theirs = await request(app).get(USER_SESSIONS).set(other.auth);

    const res = await request(app)
      .delete(`${USER_SESSIONS}/${theirs.body.data[0].id}`)
      .set(me.auth);
    expect(res.status).toBe(404);
  });

  it("200 revokes the user's own session", async () => {
    const { auth } = await loginUser();
    const list = await request(app).get(USER_SESSIONS).set(auth);
    const res = await request(app)
      .delete(`${USER_SESSIONS}/${list.body.data[0].id}`)
      .set(auth);
    expect(res.status).toBe(200);
    expect((await request(app).get(USER_SESSIONS).set(auth)).status).toBe(401);
  });
});

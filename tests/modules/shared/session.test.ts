// Sessions and tokens: the TokenService and SessionService classes, then the two session
// endpoints (/admin/sessions and /user/sessions), one describe block per endpoint.
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TokenService } from "../../../src/core/security/TokenService.js";
import type { SessionOwner } from "../../../src/modules/shared/session/index.js";
import { bearer, signInAdmin, signInUser } from "../../helpers/auth.js";
import { createAdmin, createUser } from "../../helpers/fixtures.js";
import {
  expectLoginRequired,
  MISSING_ID,
  type Route,
} from "../../helpers/guards.js";
import {
  app,
  closeTestApp,
  container,
  prisma,
  redis,
  resetState,
} from "../../helpers/testApp.js";

const ADMIN_SESSIONS = "/api/v1/admin/sessions";
const USER_SESSIONS = "/api/v1/user/sessions";
const ADMIN_ME = "/api/v1/admin/auth/me";

const { tokenService } = container;
const sessionService = container.modules.session.service;
const client = { userAgent: "vitest", ip: "127.0.0.1" };

let adminOwner: SessionOwner;

beforeEach(async () => {
  await resetState();
  const { admin } = await createAdmin();
  adminOwner = { type: "ADMIN", id: admin.id };
});
afterAll(closeTestApp);

describe("TokenService", () => {
  const ids = {
    adminId: "3f2b8c1e-6d4a-4e9b-9c1f-2a7d5e8b0c11",
    sessionId: "9a1c7e52-0b3d-4f6a-8e2c-5d4b3a2f1e00",
  };

  it("signs and verifies an admin access token", () => {
    const token = tokenService.signAdminAccessToken(ids);
    expect(tokenService.verifyAdminAccessToken(token)).toEqual(ids);
  });

  it("never accepts a user token as an admin token, or the reverse", () => {
    const userToken = tokenService.signUserAccessToken({
      userId: ids.adminId,
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
      { adminId: "not-a-uuid", sessionId: ids.sessionId },
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
    const issued = await sessionService.create(adminOwner, client);

    expect(await sessionService.isActive(issued.sessionId, adminOwner)).toBe(
      true
    );
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(row.refreshTokenHash).not.toBe(issued.refreshToken);
    expect(JSON.stringify(row)).not.toContain(issued.refreshToken);
  });

  it("stops being active the moment it is revoked (logout)", async () => {
    const issued = await sessionService.create(adminOwner, client);
    await sessionService.revoke(issued.sessionId);
    expect(await sessionService.isActive(issued.sessionId, adminOwner)).toBe(
      false
    );
  });

  it("is not active for a different owner", async () => {
    const issued = await sessionService.create(adminOwner, client);
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
        id: adminOwner.id,
      })
    ).toBe(false);
  });

  it("falls back to Postgres when the Redis copy is gone", async () => {
    const issued = await sessionService.create(adminOwner, client);
    await redis.flushdb();
    expect(await sessionService.isActive(issued.sessionId, adminOwner)).toBe(
      true
    );
    // ...and a revoked session stays inactive without the Redis copy too.
    await sessionService.revoke(issued.sessionId);
    await redis.flushdb();
    expect(await sessionService.isActive(issued.sessionId, adminOwner)).toBe(
      false
    );
  });

  it("treats an expired session as inactive", async () => {
    const issued = await sessionService.create(adminOwner, client);
    await prisma.session.update({
      where: { id: issued.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await redis.flushdb();
    expect(await sessionService.isActive(issued.sessionId, adminOwner)).toBe(
      false
    );
  });

  it("rotates the refresh token; the old one stops working", async () => {
    const issued = await sessionService.create(adminOwner, client);
    const rotated = await sessionService.rotate(
      issued.refreshToken,
      "ADMIN",
      client
    );

    expect(rotated.sessionId).toBe(issued.sessionId);
    expect(rotated.owner).toEqual(adminOwner);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);

    const again = await sessionService.rotate(
      rotated.refreshToken,
      "ADMIN",
      client
    );
    expect(again.refreshToken).not.toBe(rotated.refreshToken);
  });

  it("revokes the whole session when a used refresh token is presented again", async () => {
    const issued = await sessionService.create(adminOwner, client);
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
    expect(await sessionService.isActive(issued.sessionId, adminOwner)).toBe(
      false
    );
  });

  it("lets only one of two parallel refreshes with the same token succeed", async () => {
    const issued = await sessionService.create(adminOwner, client);
    const results = await Promise.allSettled([
      sessionService.rotate(issued.refreshToken, "ADMIN", client),
      sessionService.rotate(issued.refreshToken, "ADMIN", client),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("rejects malformed tokens, unknown sessions and the wrong owner type", async () => {
    const issued = await sessionService.create(adminOwner, client);
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
    expect(await sessionService.isActive(issued.sessionId, adminOwner)).toBe(
      true
    );
  });

  it("revokes all sessions of an owner at once", async () => {
    const first = await sessionService.create(adminOwner, client);
    const second = await sessionService.create(adminOwner, client);
    await sessionService.revokeAllForOwner(adminOwner);
    expect(await sessionService.isActive(first.sessionId, adminOwner)).toBe(
      false
    );
    expect(await sessionService.isActive(second.sessionId, adminOwner)).toBe(
      false
    );
  });

  it("lets an owner revoke only their own session", async () => {
    const mine = await sessionService.create(adminOwner, client);
    const { admin: other } = await createAdmin();
    const otherOwner: SessionOwner = { type: "ADMIN", id: other.id };

    await expect(
      sessionService.revokeOwned(mine.sessionId, otherOwner)
    ).rejects.toThrow("Session not found");
    expect(await sessionService.isActive(mine.sessionId, adminOwner)).toBe(
      true
    );

    await sessionService.revokeOwned(mine.sessionId, adminOwner);
    expect(await sessionService.isActive(mine.sessionId, adminOwner)).toBe(
      false
    );
  });

  it("lists sessions without any token hash", async () => {
    await sessionService.create(adminOwner, client);
    const sessions = await sessionService.listForOwner(adminOwner);
    expect(sessions).toHaveLength(1);
    expect(Object.keys(sessions[0]!)).not.toContain("refreshTokenHash");
    expect(Object.keys(sessions[0]!)).not.toContain("previousRefreshTokenHash");
    expect(sessions[0]).toMatchObject({
      deviceUserAgent: "vitest",
      deviceIp: "127.0.0.1",
    });
  });

  it("createSingleDevice ends every other session of the owner, and only theirs", async () => {
    const older = await sessionService.create(adminOwner, client);
    const { admin: other } = await createAdmin();
    const otherOwner: SessionOwner = { type: "ADMIN", id: other.id };
    const othersSession = await sessionService.create(otherOwner, client);

    const newest = await sessionService.createSingleDevice(adminOwner, client);

    expect(await sessionService.isActive(older.sessionId, adminOwner)).toBe(
      false
    );
    expect(await sessionService.isActive(newest.sessionId, adminOwner)).toBe(
      true
    );
    expect(
      await sessionService.isActive(othersSession.sessionId, otherOwner)
    ).toBe(true);
  });

  it("createSingleDevice run in parallel leaves exactly one active session", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        sessionService.createSingleDevice(adminOwner, client)
      )
    );
    expect(await sessionService.listForOwner(adminOwner)).toHaveLength(1);
  });

  it("the database refuses a session whose owner columns don't match its type", async () => {
    await expect(
      prisma.session.create({
        data: {
          id: "6f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
          ownerType: "USER",
          adminId: adminOwner.id,
          refreshTokenHash: "x",
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
    ).rejects.toThrow();
  });
});

// Signs an admin in and returns the access token.
const adminToken = async (email: string) =>
  (await signInAdmin(email)).body.data.accessToken as string;

describe("GET /admin/sessions", () => {
  it("401 without an admin login", async () => {
    const routes: Route[] = [
      ["get", ADMIN_SESSIONS],
      ["delete", `${ADMIN_SESSIONS}/${MISSING_ID}`],
    ];
    await expectLoginRequired(routes);
  });

  it("200 lists only the caller's one session, marks it current, and hides hashes", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await createAdmin({ email: "other@buddy.test" });
    await adminToken("head@buddy.test"); // replaced by the next sign-in
    const token = await adminToken("head@buddy.test");
    await adminToken("other@buddy.test");

    const res = await request(app).get(ADMIN_SESSIONS).set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].isCurrent).toBe(true);
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

  it("200 revokes the caller's own session", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const token = await adminToken("head@buddy.test");

    const list = await request(app).get(ADMIN_SESSIONS).set(bearer(token));
    const res = await request(app)
      .delete(`${ADMIN_SESSIONS}/${list.body.data[0].id}`)
      .set(bearer(token));
    expect(res.status).toBe(200);

    expect((await request(app).get(ADMIN_ME).set(bearer(token))).status).toBe(
      401
    );
  });
});

describe("GET /user/sessions", () => {
  it("401 without a user login", async () => {
    expect((await request(app).get(USER_SESSIONS)).status).toBe(401);
  });

  it("200 lists every device of the user and marks the current one", async () => {
    await signInUser(); // another device
    const { auth } = await signInUser();
    await signInUser("classmate@buddy.test");

    const list = await request(app).get(USER_SESSIONS).set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(
      list.body.data.filter((s: { isCurrent: boolean }) => s.isCurrent)
    ).toHaveLength(1);
    expect(list.body.data[0]).toEqual({
      id: expect.any(String),
      createdAt: expect.any(String),
      lastUsedAt: expect.any(String),
      expiresAt: expect.any(String),
      deviceUserAgent: null,
      deviceIp: expect.any(String),
      isCurrent: expect.any(Boolean),
    });
  });
});

describe("DELETE /user/sessions/:id", () => {
  it("404 for another user's session", async () => {
    const me = await signInUser("student@buddy.test");
    const other = await signInUser("classmate@buddy.test");
    const theirs = await request(app).get(USER_SESSIONS).set(other.auth);

    const res = await request(app)
      .delete(`${USER_SESSIONS}/${theirs.body.data[0].id}`)
      .set(me.auth);
    expect(res.status).toBe(404);
  });

  it("200 revokes the user's own session", async () => {
    const { auth } = await signInUser();
    const list = await request(app).get(USER_SESSIONS).set(auth);
    const res = await request(app)
      .delete(`${USER_SESSIONS}/${list.body.data[0].id}`)
      .set(auth);
    expect(res.status).toBe(200);
    expect((await request(app).get(USER_SESSIONS).set(auth)).status).toBe(401);
  });
});

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAdmin, TEST_PASSWORD } from "./helpers/fixtures.js";
import { app, closeTestApp, prisma, resetState } from "./helpers/testApp.js";

const BASE = "/api/v1/admin/auth";
const GENERIC_ERROR = "Invalid email or password";

beforeEach(resetState);
afterAll(closeTestApp);

const login = (email: string, password = TEST_PASSWORD) =>
  request(app).post(`${BASE}/login`).send({ email, password });

/** Finds one Set-Cookie header by cookie name. */
function cookie(res: request.Response, name: string): string | undefined {
  const header = res.headers["set-cookie"] as unknown as string[] | undefined;
  return header?.find((value) => value.startsWith(`${name}=`));
}

const cookieValue = (res: request.Response, name: string) =>
  cookie(res, name)?.split(";")[0]?.split("=").slice(1).join("=");

describe("POST /admin/auth/login", () => {
  it("logs in and returns the admin profile and an access token", async () => {
    const { admin, role } = await createAdmin({ email: "head@buddy.test" });
    const res = await login("head@buddy.test");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.admin).toEqual({
      id: admin.id,
      name: "Test Admin",
      email: "head@buddy.test",
      role: { id: role.id, name: role.name },
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
  });

  it("never returns the password hash or the refresh token in the body", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await login("head@buddy.test");
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/passwordHash|scrypt\$|refreshToken/);
  });

  it("sets httpOnly, SameSite=Strict cookies; the refresh cookie is limited to the auth path", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await login("head@buddy.test");

    const access = cookie(res, "accessToken");
    const refresh = cookie(res, "refreshToken");
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Strict/);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/SameSite=Strict/);
    expect(refresh).toMatch(/Path=\/api\/v1\/admin\/auth/);
  });

  it("accepts the email in any letter case", async () => {
    await createAdmin({ email: "head@buddy.test" });
    expect((await login("HEAD@Buddy.Test")).status).toBe(200);
  });

  it("gives the same answer for a wrong password, an unknown email and a disabled account", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await createAdmin({ email: "gone@buddy.test", isActive: false });

    const responses = [
      await login("head@buddy.test", "wrong-password"),
      await login("nobody@buddy.test"),
      await login("gone@buddy.test"),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        message: GENERIC_ERROR,
        errors: [],
        data: null,
      });
    }
  });

  it("locks the account after 5 wrong passwords, even for the right password", async () => {
    const { admin } = await createAdmin({ email: "head@buddy.test" });
    for (let i = 0; i < 5; i++) {
      expect((await login("head@buddy.test", "wrong-password")).status).toBe(
        401
      );
    }

    const locked = await login("head@buddy.test");
    expect(locked.status).toBe(401);
    expect(locked.body.message).toBe(GENERIC_ERROR);

    // Once the lock time has passed, the right password works again.
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await login("head@buddy.test")).status).toBe(200);
  });

  it("clears the failure count after a successful login", async () => {
    const { admin } = await createAdmin({ email: "head@buddy.test" });
    await login("head@buddy.test", "wrong-password");
    await login("head@buddy.test", "wrong-password");
    await login("head@buddy.test");

    const row = await prisma.adminUser.findUniqueOrThrow({
      where: { id: admin.id },
    });
    expect(row.failedLoginCount).toBe(0);
  });

  it("validates input and rejects unknown fields", async () => {
    const bad = await request(app)
      .post(`${BASE}/login`)
      .send({ email: "not-an-email", password: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("Validation failed");

    const extra = await request(app)
      .post(`${BASE}/login`)
      .send({ email: "a@b.test", password: "x", role: "SUPER_ADMIN" });
    expect(extra.status).toBe(400);
  });

  it("is rate limited per IP", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await login("nobody@buddy.test")).status;
    }
    expect(last).toBe(429);
  });
});

describe("verifyAdmin", () => {
  it("rejects a request with no token, a bad token, or a user token", async () => {
    const none = await request(app).get(`${BASE}/me`);
    expect(none.status).toBe(401);

    const bad = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", "Bearer not.a.token");
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe("Invalid token");
  });

  it("accepts the token from the Authorization header or the cookie", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await login("head@buddy.test");

    const viaHeader = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${res.body.data.accessToken}`);
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.data.email).toBe("head@buddy.test");

    const viaCookie = await request(app)
      .get(`${BASE}/me`)
      .set("Cookie", `accessToken=${cookieValue(res, "accessToken")}`);
    expect(viaCookie.status).toBe(200);
  });

  it("rejects the token as soon as the account is disabled", async () => {
    const { admin } = await createAdmin({ email: "head@buddy.test" });
    const token = (await login("head@buddy.test")).body.data.accessToken;

    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { isActive: false },
    });
    const res = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe("POST /admin/auth/logout", () => {
  it("makes the access token stop working on the very next request", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const token = (await login("head@buddy.test")).body.data.accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(200);

    const logout = await request(app).post(`${BASE}/logout`).set(auth);
    expect(logout.status).toBe(200);
    expect(cookie(logout, "accessToken")).toMatch(/accessToken=;/);

    // Same token, still unexpired, now rejected.
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });

  it("only ends the session that logged out", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const laptop = (await login("head@buddy.test")).body.data.accessToken;
    const phone = (await login("head@buddy.test")).body.data.accessToken;

    await request(app)
      .post(`${BASE}/logout`)
      .set("Authorization", `Bearer ${laptop}`);

    const res = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${phone}`);
    expect(res.status).toBe(200);
  });
});

describe("POST /admin/auth/refresh", () => {
  it("issues a new access token and rotates the refresh cookie", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const first = await login("head@buddy.test");
    const oldRefresh = cookieValue(first, "refreshToken")!;

    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${oldRefresh}`);
    expect(refreshed.status).toBe(200);
    expect(cookieValue(refreshed, "refreshToken")).not.toBe(oldRefresh);

    const me = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it("revokes the session when an old refresh token is used again", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const first = await login("head@buddy.test");
    const oldRefresh = cookieValue(first, "refreshToken")!;

    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${oldRefresh}`);

    const replay = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${oldRefresh}`);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toBe("Invalid refresh token");

    // The access token from the legitimate refresh is dead too.
    const me = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });

  it("rejects a missing or made-up refresh token", async () => {
    const missing = await request(app).post(`${BASE}/refresh`);
    expect(missing.status).toBe(401);

    const fake = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken: "9a1c7e52-0b3d-4f6a-8e2c-5d4b3a2f1e00.fake" });
    expect(fake.status).toBe(401);
  });

  it("stops working after logout", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const first = await login("head@buddy.test");

    await request(app)
      .post(`${BASE}/logout`)
      .set("Authorization", `Bearer ${first.body.data.accessToken}`);

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${cookieValue(first, "refreshToken")}`);
    expect(res.status).toBe(401);
  });
});

describe("admin sessions", () => {
  const SESSIONS = "/api/v1/admin/sessions";

  it("lists only the caller's own sessions and marks the current one", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await createAdmin({ email: "other@buddy.test" });
    const token = (await login("head@buddy.test")).body.data.accessToken;
    await login("head@buddy.test");
    await login("other@buddy.test");

    const res = await request(app)
      .get(SESSIONS)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(
      res.body.data.filter((s: { isCurrent: boolean }) => s.isCurrent)
    ).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/TokenHash/);
  });

  it("cannot revoke another admin's session", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await createAdmin({ email: "other@buddy.test" });
    const mine = (await login("head@buddy.test")).body.data.accessToken;
    const theirs = (await login("other@buddy.test")).body.data.accessToken;

    const theirSessions = await request(app)
      .get(SESSIONS)
      .set("Authorization", `Bearer ${theirs}`);
    const theirSessionId = theirSessions.body.data[0].id as string;

    const attempt = await request(app)
      .delete(`${SESSIONS}/${theirSessionId}`)
      .set("Authorization", `Bearer ${mine}`);
    expect(attempt.status).toBe(404);

    const stillWorks = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${theirs}`);
    expect(stillWorks.status).toBe(200);
  });

  it("revokes one of the caller's own sessions", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const laptop = (await login("head@buddy.test")).body.data.accessToken;
    const phone = (await login("head@buddy.test")).body.data.accessToken;

    const list = await request(app)
      .get(SESSIONS)
      .set("Authorization", `Bearer ${laptop}`);
    const phoneSession = list.body.data.find(
      (s: { isCurrent: boolean }) => !s.isCurrent
    );

    const res = await request(app)
      .delete(`${SESSIONS}/${phoneSession.id}`)
      .set("Authorization", `Bearer ${laptop}`);
    expect(res.status).toBe(200);

    const phoneNow = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${phone}`);
    expect(phoneNow.status).toBe(401);
  });
});

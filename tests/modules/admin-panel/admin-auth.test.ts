// /admin/auth: admin panel sign-in with Google, one device at a time.
// Each describe block is one endpoint, in the order: guards → 400 → 401 → rule failures → success.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_GOOGLE_SIGN_IN,
  adminWith,
  bearer,
  signInAdmin,
  superAdmin,
} from "../../helpers/auth.js";
import { createAdmin } from "../../helpers/fixtures.js";
import {
  app,
  closeTestApp,
  prisma,
  resetState,
} from "../../helpers/testApp.js";

const BASE = "/api/v1/admin/auth";
const SIGN_IN_FAILED = "Google sign-in failed";

beforeEach(resetState);
afterAll(closeTestApp);

// Finds one Set-Cookie header by cookie name.
function cookie(res: request.Response, name: string): string | undefined {
  const header = res.headers["set-cookie"] as unknown as string[] | undefined;
  return header?.find((value) => value.startsWith(`${name}=`));
}

const cookieValue = (res: request.Response, name: string) =>
  cookie(res, name)?.split(";")[0]?.split("=").slice(1).join("=");

const accessTokenOf = (res: request.Response) =>
  res.body.data.accessToken as string;

describe("POST /admin/auth/google", () => {
  it("400 for a missing token and for unknown fields", async () => {
    const missing = await request(app).post(ADMIN_GOOGLE_SIGN_IN).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe("Validation failed");

    const extra = await request(app)
      .post(ADMIN_GOOGLE_SIGN_IN)
      .send({ idToken: "x", role: "SUPER_ADMIN" });
    expect(extra.status).toBe(400);
  });

  it("401 with the same answer for a bad token, an unknown email, a disabled account and another Google account", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await createAdmin({ email: "gone@buddy.test", isActive: false });
    await signInAdmin("head@buddy.test"); // links head@ to its Google account

    const responses = [
      await request(app).post(ADMIN_GOOGLE_SIGN_IN).send({ idToken: "forged" }),
      await signInAdmin("nobody@buddy.test"),
      await signInAdmin("gone@buddy.test"),
      await signInAdmin("head@buddy.test", {
        googleAccountId: "google-someone-else",
      }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        message: SIGN_IN_FAILED,
        errors: [],
        data: null,
      });
    }
  });

  it("429 after too many attempts from one IP", async () => {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 21; attempt++) {
      lastStatus = (await signInAdmin("nobody@buddy.test")).status;
    }
    expect(lastStatus).toBe(429);
  });

  it("200 on first sign-in links the Google account and returns the profile", async () => {
    const { admin, role } = await createAdmin({ email: "head@buddy.test" });
    const res = await signInAdmin("head@buddy.test");

    expect(res.status).toBe(200);
    expect(res.body.data.admin).toEqual({
      id: admin.id,
      name: "Test Admin",
      email: "head@buddy.test",
      avatarUrl: "https://lh3.googleusercontent.com/a/test-avatar",
      role: { id: role.id, name: role.name },
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    const row = await prisma.admin.findUniqueOrThrow({
      where: { id: admin.id },
    });
    expect(row.googleAccountId).toBe("google-head@buddy.test");
    expect(row.lastLoginAt).toBeInstanceOf(Date);
  });

  it("200 by Google account after the first sign-in, even if the Google email changed", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await signInAdmin("head@buddy.test");

    const res = await signInAdmin("renamed@gmail.test", {
      googleAccountId: "google-head@buddy.test",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.admin.email).toBe("head@buddy.test");
  });

  it("200 never returns the refresh token or the Google id in the body", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await signInAdmin("head@buddy.test");
    expect(JSON.stringify(res.body)).not.toMatch(
      /refreshToken|googleAccountId|tokenHash/
    );
  });

  it("200 sets httpOnly, SameSite=Strict cookies; the refresh cookie is limited to the auth path", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await signInAdmin("head@buddy.test");

    const access = cookie(res, "accessToken");
    const refresh = cookie(res, "refreshToken");
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Strict/);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/SameSite=Strict/);
    expect(refresh).toMatch(/Path=\/api\/v1\/admin\/auth/);
  });

  it("200 and the previous device is signed out: one device at a time", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const laptop = await signInAdmin("head@buddy.test");
    const phone = await signInAdmin("head@buddy.test");

    const laptopMe = await request(app)
      .get(`${BASE}/me`)
      .set(bearer(accessTokenOf(laptop)));
    expect(laptopMe.status).toBe(401);

    const laptopRefresh = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${cookieValue(laptop, "refreshToken")}`);
    expect(laptopRefresh.status).toBe(401);

    const phoneMe = await request(app)
      .get(`${BASE}/me`)
      .set(bearer(accessTokenOf(phone)));
    expect(phoneMe.status).toBe(200);
  });

  it("200 for parallel sign-ins leaves exactly one active session", async () => {
    const { admin } = await createAdmin({ email: "head@buddy.test" });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => signInAdmin("head@buddy.test"))
    );
    expect(results.every((res) => res.status === 200)).toBe(true);

    const activeSessions = await prisma.session.count({
      where: { adminId: admin.id, revokedAt: null },
    });
    expect(activeSessions).toBe(1);
  });
});

describe("GET /admin/auth/me", () => {
  it("401 with no token or a bad token", async () => {
    expect((await request(app).get(`${BASE}/me`)).status).toBe(401);

    const bad = await request(app).get(`${BASE}/me`).set(bearer("not.a.token"));
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe("Invalid token");
  });

  it("401 as soon as the account is disabled", async () => {
    const { admin, auth } = await adminWith([]);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { isActive: false },
    });
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });

  it("200 with the token in the Authorization header or the cookie", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await signInAdmin("head@buddy.test");

    const viaHeader = await request(app)
      .get(`${BASE}/me`)
      .set(bearer(accessTokenOf(res)));
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.data.email).toBe("head@buddy.test");

    const viaCookie = await request(app)
      .get(`${BASE}/me`)
      .set("Cookie", `accessToken=${cookieValue(res, "accessToken")}`);
    expect(viaCookie.status).toBe(200);
  });

  it("200 includes the pages the admin may open (all pages for SUPER_ADMIN)", async () => {
    const staff = await adminWith(["UPLOAD"]);
    const staffMe = await request(app).get(`${BASE}/me`).set(staff.auth);
    expect(staffMe.body.data.pages).toEqual(["UPLOAD"]);

    const boss = await superAdmin();
    const bossMe = await request(app).get(`${BASE}/me`).set(boss.auth);
    expect(bossMe.body.data.pages).toEqual([
      "ROLE",
      "UPLOAD",
      "ORGANIZATION",
      "ADMIN",
    ]);
  });
});

describe("POST /admin/auth/refresh", () => {
  it("401 for a missing or made-up refresh token", async () => {
    const missing = await request(app).post(`${BASE}/refresh`);
    expect(missing.status).toBe(401);

    const fake = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken: "9a1c7e52-0b3d-4f6a-8e2c-5d4b3a2f1e00.fake" });
    expect(fake.status).toBe(401);
  });

  it("401 after logout", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const signIn = await signInAdmin("head@buddy.test");

    await request(app)
      .post(`${BASE}/logout`)
      .set(bearer(accessTokenOf(signIn)));

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${cookieValue(signIn, "refreshToken")}`);
    expect(res.status).toBe(401);
  });

  it("401 and the whole session revoked when an old refresh token is used again", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const signIn = await signInAdmin("head@buddy.test");
    const oldRefreshToken = cookieValue(signIn, "refreshToken")!;

    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${oldRefreshToken}`);

    const replay = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${oldRefreshToken}`);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toBe("Invalid refresh token");

    // The access token from the legitimate refresh is dead too.
    const me = await request(app)
      .get(`${BASE}/me`)
      .set(bearer(accessTokenOf(refreshed)));
    expect(me.status).toBe(401);
  });

  it("200 issues a new access token and rotates the refresh cookie", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const signIn = await signInAdmin("head@buddy.test");
    const oldRefreshToken = cookieValue(signIn, "refreshToken")!;

    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${oldRefreshToken}`);
    expect(refreshed.status).toBe(200);
    expect(cookieValue(refreshed, "refreshToken")).not.toBe(oldRefreshToken);

    const me = await request(app)
      .get(`${BASE}/me`)
      .set(bearer(accessTokenOf(refreshed)));
    expect(me.status).toBe(200);
  });
});

describe("POST /admin/auth/logout", () => {
  it("401 without a token", async () => {
    expect((await request(app).post(`${BASE}/logout`)).status).toBe(401);
  });

  it("200 and the access token stops working on the very next request", async () => {
    const { auth } = await adminWith([]);
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(200);

    const logout = await request(app).post(`${BASE}/logout`).set(auth);
    expect(logout.status).toBe(200);
    expect(cookie(logout, "accessToken")).toMatch(/accessToken=;/);

    // Same token, still unexpired, now rejected.
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });
});

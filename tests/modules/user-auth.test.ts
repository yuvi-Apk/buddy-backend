// /user/auth: app sign-in with Google. Many devices per user, and "log out all devices".
// The refresh token travels only in the httpOnly userRefreshToken cookie.
// Each describe block is one endpoint, in the order: guards → 400 → 401/429 → success.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bearer,
  cookieValue,
  signInUser,
  signInUserRequest,
  USER_GOOGLE_SIGN_IN,
} from "../helpers/auth.js";
import { createUser } from "../helpers/fixtures.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const BASE = "/api/v1/user/auth";
const SIGN_IN_FAILED = "Google sign-in failed";
const REFRESH_COOKIE = "userRefreshToken";

// The Set-Cookie header of the refresh cookie, with its attributes.
function refreshCookie(res: request.Response): string | undefined {
  const header = res.headers["set-cookie"] as unknown as string[] | undefined;
  return header?.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
}

const withRefreshCookie = (refreshToken: string) => ({
  Cookie: `${REFRESH_COOKIE}=${refreshToken}`,
});

beforeEach(resetState);
afterAll(closeTestApp);

describe("POST /user/auth/google", () => {
  it("400 for a missing token and for unknown fields", async () => {
    expect((await request(app).post(USER_GOOGLE_SIGN_IN).send({})).status).toBe(
      400
    );

    const extra = await request(app)
      .post(USER_GOOGLE_SIGN_IN)
      .send({ idToken: "x", canJoinMultipleOrganizations: true });
    expect(extra.status).toBe(400);
  });

  it("401 with the same answer for a bad token and a disabled account", async () => {
    await createUser({
      email: "gone@buddy.test",
      googleAccountId: "google-gone@buddy.test",
      isActive: false,
    });

    const responses = [
      await request(app).post(USER_GOOGLE_SIGN_IN).send({ idToken: "forged" }),
      await signInUserRequest("gone@buddy.test"),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body.message).toBe(SIGN_IN_FAILED);
    }
  });

  it("429 after too many attempts from one IP", async () => {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 21; attempt++) {
      lastStatus = (
        await request(app).post(USER_GOOGLE_SIGN_IN).send({ idToken: "forged" })
      ).status;
    }
    expect(lastStatus).toBe(429);
  });

  it("200 creates the account on first sign-in from the Google profile", async () => {
    const res = await signInUserRequest("Student@Buddy.Test");

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({
      id: expect.any(String),
      email: "student@buddy.test",
      name: "Google Name",
      avatarUrl: "https://lh3.googleusercontent.com/a/test-avatar",
      examCategory: null,
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(cookieValue(res, REFRESH_COOKIE)).toEqual(expect.any(String));

    const row = await prisma.user.findFirstOrThrow();
    expect(row.googleAccountId).toBe("google-student@buddy.test");
    expect(row.canJoinMultipleOrganizations).toBe(false);
  });

  it("200 reuses the same account on the next sign-in", async () => {
    const first = await signInUser();
    const second = await signInUser();
    expect(second.user.id).toBe(first.user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it("200 for parallel first sign-ins creates one account", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => signInUserRequest("student@buddy.test"))
    );
    expect(results.every((res) => res.status === 200)).toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });

  it("200 keeps the other devices signed in", async () => {
    const phone = await signInUser();
    const tablet = await signInUser();

    expect((await request(app).get(`${BASE}/me`).set(phone.auth)).status).toBe(
      200
    );
    expect((await request(app).get(`${BASE}/me`).set(tablet.auth)).status).toBe(
      200
    );
  });

  it("200 never returns the refresh token, the Google id or a hash in the body", async () => {
    const res = await signInUserRequest("student@buddy.test");
    expect(JSON.stringify(res.body)).not.toMatch(
      /refreshToken|googleAccountId|tokenHash|isActive/
    );
  });

  it("200 sets an httpOnly, SameSite=Strict refresh cookie limited to the auth path", async () => {
    const res = await signInUserRequest("student@buddy.test");
    const cookie = refreshCookie(res);

    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/user\/auth/);
    expect(cookie).toMatch(/Expires=/);
  });
});

describe("GET /user/auth/me", () => {
  it("401 without a token", async () => {
    expect((await request(app).get(`${BASE}/me`)).status).toBe(401);
  });

  it("401 as soon as the account is disabled", async () => {
    const { auth, user } = await signInUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });

  it("200 returns the user's profile", async () => {
    const { auth } = await signInUser();
    const me = await request(app).get(`${BASE}/me`).set(auth);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe("student@buddy.test");
  });
});

describe("POST /user/auth/refresh", () => {
  it("400 for unknown fields", async () => {
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken: "x", userId: "someone-else" });
    expect(res.status).toBe(400);
  });

  it("401 without a refresh token", async () => {
    const res = await request(app).post(`${BASE}/refresh`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid refresh token");
  });

  it("401 for a made-up refresh token, and the cookie is cleared", async () => {
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set(withRefreshCookie("9a1c7e52-0b3d-4f6a-8e2c-5d4b3a2f1e00.fake"));
    expect(res.status).toBe(401);
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("200 with the refresh cookie, and the cookie is rotated", async () => {
    const { refreshToken } = await signInUser();

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set(withRefreshCookie(refreshToken));
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe("student@buddy.test");
    expect(JSON.stringify(res.body)).not.toMatch(/refreshToken/);

    const rotated = cookieValue(res, REFRESH_COOKIE);
    expect(rotated).toEqual(expect.any(String));
    expect(rotated).not.toBe(refreshToken);
  });

  it("401 and the whole session revoked when an old refresh token is used again", async () => {
    const { refreshToken } = await signInUser();

    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });

    const replay = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });
    expect(replay.status).toBe(401);

    const me = await request(app)
      .get(`${BASE}/me`)
      .set(bearer(refreshed.body.data.accessToken as string));
    expect(me.status).toBe(401);
  });

  it("401 for a disabled account, and the session ends", async () => {
    const { refreshToken, user } = await signInUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });
    expect(res.status).toBe(401);
    expect(
      await prisma.session.count({
        where: { userId: user.id, revokedAt: null },
      })
    ).toBe(0);
  });

  it("200 with the token in the body, for API clients", async () => {
    const { refreshToken } = await signInUser();
    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(cookieValue(refreshed, REFRESH_COOKIE)).not.toBe(refreshToken);
  });
});

describe("POST /user/auth/logout", () => {
  it("401 without a token", async () => {
    expect((await request(app).post(`${BASE}/logout`)).status).toBe(401);
  });

  it("200 and the access token stops working right away", async () => {
    const { auth } = await signInUser();
    expect((await request(app).post(`${BASE}/logout`).set(auth)).status).toBe(
      200
    );
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });

  it("200 clears the refresh cookie, and the old refresh token is refused", async () => {
    const { auth, refreshToken } = await signInUser();

    const res = await request(app).post(`${BASE}/logout`).set(auth);
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);

    const refresh = await request(app)
      .post(`${BASE}/refresh`)
      .set(withRefreshCookie(refreshToken));
    expect(refresh.status).toBe(401);
  });

  it("200 and only this device is logged out", async () => {
    const phone = await signInUser();
    const tablet = await signInUser();

    await request(app).post(`${BASE}/logout`).set(phone.auth);
    expect((await request(app).get(`${BASE}/me`).set(tablet.auth)).status).toBe(
      200
    );
  });
});

describe("POST /user/auth/logout-all", () => {
  it("401 without a token", async () => {
    expect((await request(app).post(`${BASE}/logout-all`)).status).toBe(401);
  });

  it("200 ends every device of the user, including refresh tokens", async () => {
    const phone = await signInUser();
    const tablet = await signInUser();

    const res = await request(app).post(`${BASE}/logout-all`).set(phone.auth);
    expect(res.status).toBe(200);

    for (const device of [phone, tablet]) {
      expect(
        (await request(app).get(`${BASE}/me`).set(device.auth)).status
      ).toBe(401);
      const refresh = await request(app)
        .post(`${BASE}/refresh`)
        .send({ refreshToken: device.refreshToken });
      expect(refresh.status).toBe(401);
    }
  });

  it("200 and other users stay signed in", async () => {
    const me = await signInUser("student@buddy.test");
    const classmate = await signInUser("classmate@buddy.test");

    await request(app).post(`${BASE}/logout-all`).set(me.auth);
    expect(
      (await request(app).get(`${BASE}/me`).set(classmate.auth)).status
    ).toBe(200);
  });
});

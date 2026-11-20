// /user/auth: app sign-in with Google. Many devices per user, and "log out all devices",
// plus the user's own name and photo (/me).
// The refresh token travels only in the httpOnly userRefreshToken cookie.
// Each describe block is one endpoint, in the order: guards → 400 → 401/429 → success.
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_IMAGES_DIR } from "../../../src/config/upload.config.js";
import {
  bearer,
  cookieValue,
  signInUser,
  signInUserRequest,
  superAdmin,
  USER_GOOGLE_SIGN_IN,
} from "../../helpers/auth.js";
import { createUser } from "../../helpers/fixtures.js";
import type { Route } from "../../helpers/guards.js";
import {
  app,
  closeTestApp,
  prisma,
  resetState,
} from "../../helpers/testApp.js";

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

// ===========================================================================
// Own profile: name and photo
// ===========================================================================

// Photo files created by these tests, removed again in afterAll.
const createdAvatarUrls: string[] = [];
const avatarDiskPath = (url: string) =>
  path.join(PUBLIC_IMAGES_DIR, url.replace(/^\/images\//, ""));
const GOOGLE_AVATAR_URL = "https://lh3.googleusercontent.com/a/test-avatar";

afterAll(async () => {
  for (const url of createdAvatarUrls) {
    await rm(avatarDiskPath(url), { force: true });
  }
});

function makePhoto(width = 400, height = 300) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31) % 256;
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function uploadAvatar(
  auth: Record<string, string>,
  file: Buffer,
  contentType = "image/png"
) {
  const res = await request(app)
    .put(`${BASE}/me/avatar`)
    .set(auth)
    .attach("image", file, { filename: "me.png", contentType });
  const avatarUrl = res.body?.data?.avatarUrl as string | undefined;
  if (avatarUrl?.startsWith("/images/")) createdAvatarUrls.push(avatarUrl);
  return res;
}

describe("guards on /user/auth/me", () => {
  it("401 without a token and with an admin token", async () => {
    const { auth: adminAuth } = await superAdmin();
    const routes: Route[] = [
      ["patch", `${BASE}/me`],
      ["put", `${BASE}/me/avatar`],
      ["delete", `${BASE}/me/avatar`],
    ];
    for (const [method, path] of routes) {
      expect((await request(app)[method](path)).status, path).toBe(401);
      expect(
        (await request(app)[method](path).set(adminAuth)).status,
        path
      ).toBe(401);
    }
  });
});

describe("PATCH /user/auth/me", () => {
  it("400 for a missing, empty or too long name and for unknown fields", async () => {
    const { auth } = await signInUser();
    for (const body of [
      {},
      { name: "" },
      { name: "   " },
      { name: "x".repeat(81) },
      { name: "Asha", email: "other@buddy.test" },
      { name: "Asha", avatarUrl: "/images/profile/x.webp" },
    ]) {
      expect(
        (await request(app).patch(`${BASE}/me`).set(auth).send(body)).status,
        JSON.stringify(body)
      ).toBe(400);
    }
  });

  it("200 saves the trimmed name and GET /me shows it", async () => {
    const { auth, user } = await signInUser();

    const res = await request(app)
      .patch(`${BASE}/me`)
      .set(auth)
      .send({ name: "  Asha Rao  " });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: user.id,
      email: "student@buddy.test",
      name: "Asha Rao",
      avatarUrl: GOOGLE_AVATAR_URL,
      examCategory: null,
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.name).toBe("Asha Rao");
    const me = await request(app).get(`${BASE}/me`).set(auth);
    expect(me.body.data.name).toBe("Asha Rao");
  });

  it("200 changes only the caller's own name", async () => {
    const me = await signInUser("student@buddy.test");
    const classmate = await signInUser("classmate@buddy.test");

    await request(app).patch(`${BASE}/me`).set(me.auth).send({ name: "Asha" });

    const other = await prisma.user.findUniqueOrThrow({
      where: { id: classmate.user.id },
    });
    expect(other.name).toBe("Google Name");
  });

  it("signing in with Google again keeps the name the user set", async () => {
    const { auth, user } = await signInUser();
    await request(app).patch(`${BASE}/me`).set(auth).send({ name: "Asha" });

    await signInUserRequest("student@buddy.test", { name: "New Google Name" });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.name).toBe("Asha");
  });
});

describe("PUT /user/auth/me/avatar", () => {
  it("400 without a file, for a non-image type, and for fake image bytes", async () => {
    const { auth } = await signInUser();

    const noFile = await request(app).put(`${BASE}/me/avatar`).set(auth);
    expect(noFile.status).toBe(400);

    const pdf = await uploadAvatar(
      auth,
      Buffer.from("%PDF-1.4"),
      "application/pdf"
    );
    expect(pdf.status).toBe(400);

    // Claims to be a PNG, but the bytes are text.
    const fake = await uploadAvatar(auth, Buffer.from("not an image"));
    expect(fake.status).toBe(400);
    expect(fake.body.message).toBe(
      "File is not a valid JPEG, PNG or WebP image"
    );
  });

  it("200 stores the photo as WebP and GET /me shows it", async () => {
    const { auth, user } = await signInUser();

    const res = await uploadAvatar(auth, await makePhoto());

    expect(res.status).toBe(200);
    const avatarUrl = res.body.data.avatarUrl as string;
    expect(avatarUrl).toMatch(/^\/images\/profile\/[0-9a-f-]{36}\.webp$/);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ["avatarUrl", "email", "examCategory", "id", "name"].sort()
    );
    expect(existsSync(avatarDiskPath(avatarUrl))).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.avatarUrl).toBe(avatarUrl);
    const me = await request(app).get(`${BASE}/me`).set(auth);
    expect(me.body.data.avatarUrl).toBe(avatarUrl);
  });

  it("200 a new photo deletes the previous stored file", async () => {
    const { auth } = await signInUser();
    const first = (await uploadAvatar(auth, await makePhoto())).body.data
      .avatarUrl as string;

    const second = await uploadAvatar(auth, await makePhoto(500, 400));

    expect(second.status).toBe(200);
    expect(second.body.data.avatarUrl).not.toBe(first);
    expect(existsSync(avatarDiskPath(first))).toBe(false);
  });

  it("signing in with Google again keeps the photo the user set", async () => {
    const { auth, user } = await signInUser();
    const avatarUrl = (await uploadAvatar(auth, await makePhoto())).body.data
      .avatarUrl as string;

    await signInUserRequest("student@buddy.test", {
      avatarUrl: "https://lh3.googleusercontent.com/a/new-photo",
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.avatarUrl).toBe(avatarUrl);
  });
});

describe("DELETE /user/auth/me/avatar", () => {
  it("200 removes the stored photo and its file", async () => {
    const { auth, user } = await signInUser();
    const avatarUrl = (await uploadAvatar(auth, await makePhoto())).body.data
      .avatarUrl as string;

    const res = await request(app).delete(`${BASE}/me/avatar`).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toBeNull();
    expect(existsSync(avatarDiskPath(avatarUrl))).toBe(false);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.avatarUrl).toBeNull();
  });

  it("200 clears a Google photo without touching storage", async () => {
    const { auth } = await signInUser();

    const res = await request(app).delete(`${BASE}/me/avatar`).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toBeNull();
  });
});

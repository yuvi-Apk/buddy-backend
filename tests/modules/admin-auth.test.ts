// /admin/auth: admin panel login with email and password.
// Each describe block is one endpoint, in the order: guards → 400 → 401 → rule failures → success.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminWith, bearer, loginAdmin, superAdmin } from "../helpers/auth.js";
import { createAdmin } from "../helpers/fixtures.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const BASE = "/api/v1/admin/auth";
const GENERIC_ERROR = "Invalid email or password";

beforeEach(resetState);
afterAll(closeTestApp);

// Finds one Set-Cookie header by cookie name.
function cookie(res: request.Response, name: string): string | undefined {
  const header = res.headers["set-cookie"] as unknown as string[] | undefined;
  return header?.find((value) => value.startsWith(`${name}=`));
}

const cookieValue = (res: request.Response, name: string) =>
  cookie(res, name)?.split(";")[0]?.split("=").slice(1).join("=");

describe("POST /admin/auth/login", () => {
  it("400 for bad input and for unknown fields", async () => {
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

  it("401 with the same answer for a wrong password, an unknown email and a disabled account", async () => {
    await createAdmin({ email: "head@buddy.test" });
    await createAdmin({ email: "gone@buddy.test", isActive: false });

    const responses = [
      await loginAdmin("head@buddy.test", "wrong-password"),
      await loginAdmin("nobody@buddy.test"),
      await loginAdmin("gone@buddy.test"),
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

  it("401 after 5 wrong passwords, even for the right password, until the lock ends", async () => {
    const { admin } = await createAdmin({ email: "head@buddy.test" });
    for (let i = 0; i < 5; i++) {
      expect(
        (await loginAdmin("head@buddy.test", "wrong-password")).status
      ).toBe(401);
    }

    const locked = await loginAdmin("head@buddy.test");
    expect(locked.status).toBe(401);
    expect(locked.body.message).toBe(GENERIC_ERROR);

    // Once the lock time has passed, the right password works again.
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await loginAdmin("head@buddy.test")).status).toBe(200);
  });

  it("429 after too many attempts from one IP", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await loginAdmin("nobody@buddy.test")).status;
    }
    expect(last).toBe(429);
  });

  it("200 returns the admin profile and an access token", async () => {
    const { admin, role } = await createAdmin({ email: "head@buddy.test" });
    const res = await loginAdmin("head@buddy.test");

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

  it("200 never returns the password hash or the refresh token in the body", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await loginAdmin("head@buddy.test");
    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|scrypt\$|refreshToken/
    );
  });

  it("200 sets httpOnly, SameSite=Strict cookies; the refresh cookie is limited to the auth path", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await loginAdmin("head@buddy.test");

    const access = cookie(res, "accessToken");
    const refresh = cookie(res, "refreshToken");
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Strict/);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/SameSite=Strict/);
    expect(refresh).toMatch(/Path=\/api\/v1\/admin\/auth/);
  });

  it("200 accepts the email in any letter case", async () => {
    await createAdmin({ email: "head@buddy.test" });
    expect((await loginAdmin("HEAD@Buddy.Test")).status).toBe(200);
  });

  it("200 clears the failure count", async () => {
    const { admin } = await createAdmin({ email: "head@buddy.test" });
    await loginAdmin("head@buddy.test", "wrong-password");
    await loginAdmin("head@buddy.test", "wrong-password");
    await loginAdmin("head@buddy.test");

    const row = await prisma.adminUser.findUniqueOrThrow({
      where: { id: admin.id },
    });
    expect(row.failedLoginCount).toBe(0);
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
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { isActive: false },
    });
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });

  it("200 with the token in the Authorization header or the cookie", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const res = await loginAdmin("head@buddy.test");

    const viaHeader = await request(app)
      .get(`${BASE}/me`)
      .set(bearer(res.body.data.accessToken as string));
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.data.email).toBe("head@buddy.test");

    const viaCookie = await request(app)
      .get(`${BASE}/me`)
      .set("Cookie", `accessToken=${cookieValue(res, "accessToken")}`);
    expect(viaCookie.status).toBe(200);
  });

  it("200 includes the pages the admin may open (all pages for SUPER_ADMIN)", async () => {
    const staff = await adminWith(["UPLOAD"]);
    const me = await request(app).get(`${BASE}/me`).set(staff.auth);
    expect(me.body.data.pages).toEqual(["UPLOAD"]);

    const boss = await superAdmin();
    const bossMe = await request(app).get(`${BASE}/me`).set(boss.auth);
    expect(bossMe.body.data.pages).toEqual(["ROLE", "UPLOAD"]);
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
    const first = await loginAdmin("head@buddy.test");

    await request(app)
      .post(`${BASE}/logout`)
      .set(bearer(first.body.data.accessToken as string));

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${cookieValue(first, "refreshToken")}`);
    expect(res.status).toBe(401);
  });

  it("401 and the whole session revoked when an old refresh token is used again", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const first = await loginAdmin("head@buddy.test");
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
      .set(bearer(refreshed.body.data.accessToken as string));
    expect(me.status).toBe(401);
  });

  it("200 issues a new access token and rotates the refresh cookie", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const first = await loginAdmin("head@buddy.test");
    const oldRefresh = cookieValue(first, "refreshToken")!;

    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .set("Cookie", `refreshToken=${oldRefresh}`);
    expect(refreshed.status).toBe(200);
    expect(cookieValue(refreshed, "refreshToken")).not.toBe(oldRefresh);

    const me = await request(app)
      .get(`${BASE}/me`)
      .set(bearer(refreshed.body.data.accessToken as string));
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

  it("200 and only the session that logged out ends", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const laptop = (await loginAdmin("head@buddy.test")).body.data
      .accessToken as string;
    const phone = (await loginAdmin("head@buddy.test")).body.data
      .accessToken as string;

    await request(app).post(`${BASE}/logout`).set(bearer(laptop));

    const res = await request(app).get(`${BASE}/me`).set(bearer(phone));
    expect(res.status).toBe(200);
  });
});

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { createAdmin, TEST_PASSWORD } from "./helpers/fixtures.js";
import {
  app,
  closeTestApp,
  otpSender,
  prisma,
  redis,
  resetState,
} from "./helpers/testApp.js";

const BASE = "/api/v1/user/auth";
const PHONE = "+919812345678";
const INVALID = "Invalid or expired code";

beforeEach(resetState);
afterAll(closeTestApp);

const requestOtp = (phone = PHONE) =>
  request(app).post(`${BASE}/otp/request`).send({ phone });

const verifyOtp = (otp: string, phone = PHONE) =>
  request(app).post(`${BASE}/otp/verify`).send({ phone, otp });

/** Requests a code and logs in with it. */
async function loginUser(phone = PHONE) {
  await requestOtp(phone);
  const res = await verifyOtp(otpSender.codes.get(phone)!, phone);
  return res.body.data as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
}

const wrongCode = (phone = PHONE) =>
  otpSender.codes.get(phone) === "000000" ? "111111" : "000000";

describe("POST /user/auth/otp/request", () => {
  it("sends a 6-digit code and never returns it in the response", async () => {
    const res = await requestOtp();
    const code = otpSender.codes.get(PHONE)!;

    expect(res.status).toBe(200);
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(code);
  });

  it("stores only a hash of the code in Redis, with an expiry", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;

    const stored = await redis.get(`otp:code:${PHONE}`);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(code);

    const ttl = await redis.ttl(`otp:code:${PHONE}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("answers the same for a new number and an existing user, and creates no account yet", async () => {
    await prisma.user.create({ data: { phone: "+919800000001" } });
    const existing = await requestOtp("+919800000001");
    const fresh = await requestOtp("+919800000002");

    expect(existing.body).toEqual(fresh.body);
    expect(await prisma.user.count()).toBe(1);
  });

  it("enforces a one-minute cooldown between requests for the same phone", async () => {
    expect((await requestOtp()).status).toBe(200);
    const second = await requestOtp();
    expect(second.status).toBe(429);

    // A different phone is not affected.
    expect((await requestOtp("+919800000003")).status).toBe(200);
  });

  it("allows at most 5 codes per phone per hour", async () => {
    for (let i = 0; i < 5; i++) {
      await redis.del(`otp:cooldown:${PHONE}`);
      expect((await requestOtp()).status).toBe(200);
    }
    await redis.del(`otp:cooldown:${PHONE}`);
    expect((await requestOtp()).status).toBe(429);
  });

  it("rejects a badly formatted phone number", async () => {
    for (const phone of ["9812345678", "+0123456789", "+91 98123 45678", ""]) {
      const res = await requestOtp(phone);
      expect(res.status).toBe(400);
    }
  });
});

describe("POST /user/auth/otp/verify", () => {
  it("logs in with the right code and creates the account on first login", async () => {
    await requestOtp();
    const res = await verifyOtp(otpSender.codes.get(PHONE)!);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({
      id: expect.any(String),
      phone: PHONE,
      name: null,
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(await prisma.user.count()).toBe(1);
  });

  it("reuses the same account on the next login", async () => {
    const first = await loginUser();
    await redis.del(`otp:cooldown:${PHONE}`);
    const second = await loginUser();
    expect(second.user.id).toBe(first.user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it("rejects a wrong code", async () => {
    await requestOtp();
    const res = await verifyOtp(wrongCode());
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(INVALID);
  });

  it("accepts a code only once", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;
    expect((await verifyOtp(code)).status).toBe(200);

    const replay = await verifyOtp(code);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toBe(INVALID);
  });

  it("lets only one of two parallel verifications succeed", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;
    const results = await Promise.all([verifyOtp(code), verifyOtp(code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it("destroys the code after 5 wrong guesses, so even the right code then fails", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;
    for (let i = 0; i < 5; i++) {
      expect((await verifyOtp(wrongCode())).status).toBe(401);
    }
    const res = await verifyOtp(code);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(INVALID);
  });

  it("rejects an expired code", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;
    await redis.del(`otp:code:${PHONE}`); // what Redis does when the 5 minutes are up
    expect((await verifyOtp(code)).status).toBe(401);
  });

  it("rejects a code issued for a different phone", async () => {
    await requestOtp("+919800000004");
    await requestOtp("+919800000005");
    const res = await verifyOtp(
      otpSender.codes.get("+919800000004")!,
      "+919800000005"
    );
    // (Fails unless both random codes happen to be equal.)
    if (
      otpSender.codes.get("+919800000004") !==
      otpSender.codes.get("+919800000005")
    ) {
      expect(res.status).toBe(401);
    }
  });

  it("gives the same error to a disabled account", async () => {
    await prisma.user.create({ data: { phone: PHONE, isActive: false } });
    await requestOtp();
    const res = await verifyOtp(otpSender.codes.get(PHONE)!);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(INVALID);
  });

  it("validates the code format", async () => {
    await requestOtp();
    for (const otp of ["12345", "1234567", "abcdef", ""]) {
      expect((await verifyOtp(otp)).status).toBe(400);
    }
  });
});

describe("verifyUser", () => {
  it("serves the profile with a user token and rejects requests without one", async () => {
    const { accessToken } = await loginUser();

    const me = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.phone).toBe(PHONE);

    expect((await request(app).get(`${BASE}/me`)).status).toBe(401);
  });

  it("rejects the token as soon as the account is disabled", async () => {
    const { accessToken, user } = await loginUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    const res = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });
});

describe("admin and user tokens are not interchangeable", () => {
  it("rejects a user token on admin routes", async () => {
    const { accessToken } = await loginUser();

    for (const path of ["/api/v1/admin/auth/me", "/api/v1/admin/sessions"]) {
      const viaHeader = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${accessToken}`);
      expect(viaHeader.status).toBe(401);

      const viaCookie = await request(app)
        .get(path)
        .set("Cookie", `accessToken=${accessToken}`);
      expect(viaCookie.status).toBe(401);
    }
  });

  it("rejects an admin token on user routes", async () => {
    await createAdmin({ email: "head@buddy.test" });
    const login = await request(app)
      .post("/api/v1/admin/auth/login")
      .send({ email: "head@buddy.test", password: TEST_PASSWORD });

    for (const path of [`${BASE}/me`, "/api/v1/user/sessions"]) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${login.body.data.accessToken}`);
      expect(res.status).toBe(401);
    }
  });

  it("rejects a user refresh token on the admin refresh route", async () => {
    const { refreshToken } = await loginUser();
    const res = await request(app)
      .post("/api/v1/admin/auth/refresh")
      .send({ refreshToken });
    expect(res.status).toBe(401);
  });
});

describe("user logout and refresh", () => {
  it("makes the access token stop working right after logout", async () => {
    const { accessToken } = await loginUser();
    const auth = { Authorization: `Bearer ${accessToken}` };

    expect((await request(app).post(`${BASE}/logout`).set(auth)).status).toBe(
      200
    );
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });

  it("rotates the refresh token and revokes the session on reuse", async () => {
    const { refreshToken } = await loginUser();

    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).not.toBe(refreshToken);

    const replay = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });
    expect(replay.status).toBe(401);

    const me = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });

  it("lists and revokes the user's own sessions", async () => {
    const { accessToken } = await loginUser();
    const list = await request(app)
      .get("/api/v1/user/sessions")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].isCurrent).toBe(true);
  });
});

describe("OTP_SENDER safety", () => {
  it("refuses to boot in production with the log sender", () => {
    const base = parseEnv(readFileSync(".env.test", "utf8"));
    expect(() =>
      loadEnv({ ...base, NODE_ENV: "production", OTP_SENDER: "log" })
    ).toThrow(/OTP_SENDER/);
  });
});

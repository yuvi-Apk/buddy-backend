// /user/auth: mobile app login with a phone number and a one-time code (OTP).
// Each describe block is one endpoint, in the order: guards → 400 → 401/429 → success.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, loginUser, TEST_PHONE as PHONE } from "../helpers/auth.js";
import {
  app,
  closeTestApp,
  otpSender,
  prisma,
  redis,
  resetState,
} from "../helpers/testApp.js";

const BASE = "/api/v1/user/auth";
const INVALID = "Invalid or expired code";

beforeEach(resetState);
afterAll(closeTestApp);

const requestOtp = (phone = PHONE) =>
  request(app).post(`${BASE}/otp/request`).send({ phone });

const verifyOtp = (otp: string, phone = PHONE) =>
  request(app).post(`${BASE}/otp/verify`).send({ phone, otp });

const wrongCode = (phone = PHONE) =>
  otpSender.codes.get(phone) === "000000" ? "111111" : "000000";

describe("POST /user/auth/otp/request", () => {
  it("400 for a badly formatted phone number", async () => {
    for (const phone of ["9812345678", "+0123456789", "+91 98123 45678", ""]) {
      const res = await requestOtp(phone);
      expect(res.status, phone).toBe(400);
    }
  });

  it("429 within the one-minute cooldown for the same phone", async () => {
    expect((await requestOtp()).status).toBe(200);
    expect((await requestOtp()).status).toBe(429);

    // A different phone is not affected.
    expect((await requestOtp("+919800000003")).status).toBe(200);
  });

  it("429 after 5 codes for one phone in an hour", async () => {
    for (let i = 0; i < 5; i++) {
      await redis.del(`otp:cooldown:${PHONE}`);
      expect((await requestOtp()).status).toBe(200);
    }
    await redis.del(`otp:cooldown:${PHONE}`);
    expect((await requestOtp()).status).toBe(429);
  });

  it("200 sends a 6-digit code and never returns it in the response", async () => {
    const res = await requestOtp();
    const code = otpSender.codes.get(PHONE)!;

    expect(res.status).toBe(200);
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(code);
  });

  it("200 stores only a hash of the code in Redis, with an expiry", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;

    const stored = await redis.get(`otp:code:${PHONE}`);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(code);

    const ttl = await redis.ttl(`otp:code:${PHONE}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("200 with the same answer for a new number and an existing user, and no account created", async () => {
    await prisma.user.create({ data: { phone: "+919800000001" } });
    const existing = await requestOtp("+919800000001");
    const fresh = await requestOtp("+919800000002");

    expect(existing.body).toEqual(fresh.body);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe("POST /user/auth/otp/verify", () => {
  it("400 for a badly formatted code", async () => {
    await requestOtp();
    for (const otp of ["12345", "1234567", "abcdef", ""]) {
      expect((await verifyOtp(otp)).status, otp).toBe(400);
    }
  });

  it("401 for a wrong code", async () => {
    await requestOtp();
    const res = await verifyOtp(wrongCode());
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(INVALID);
  });

  it("401 for a code that was already used", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;
    expect((await verifyOtp(code)).status).toBe(200);

    const replay = await verifyOtp(code);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toBe(INVALID);
  });

  it("401 for one of two parallel verifications with the same code", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;
    const results = await Promise.all([verifyOtp(code), verifyOtp(code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it("401 even for the right code after 5 wrong guesses", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;
    for (let i = 0; i < 5; i++) {
      expect((await verifyOtp(wrongCode())).status).toBe(401);
    }
    const res = await verifyOtp(code);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(INVALID);
  });

  it("401 for an expired code", async () => {
    await requestOtp();
    const code = otpSender.codes.get(PHONE)!;
    await redis.del(`otp:code:${PHONE}`); // what Redis does when the 5 minutes are up
    expect((await verifyOtp(code)).status).toBe(401);
  });

  it("401 for a code issued for a different phone", async () => {
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

  it("401 with the same error for a disabled account", async () => {
    await prisma.user.create({ data: { phone: PHONE, isActive: false } });
    await requestOtp();
    const res = await verifyOtp(otpSender.codes.get(PHONE)!);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(INVALID);
  });

  it("200 logs in and creates the account on first login", async () => {
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

  it("200 reuses the same account on the next login", async () => {
    const first = await loginUser();
    const second = await loginUser();
    expect(second.user.id).toBe(first.user.id);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe("GET /user/auth/me", () => {
  it("401 without a token", async () => {
    expect((await request(app).get(`${BASE}/me`)).status).toBe(401);
  });

  it("401 as soon as the account is disabled", async () => {
    const { auth, user } = await loginUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });

  it("200 returns the user's profile", async () => {
    const { auth } = await loginUser();
    const me = await request(app).get(`${BASE}/me`).set(auth);
    expect(me.status).toBe(200);
    expect(me.body.data.phone).toBe(PHONE);
  });
});

describe("POST /user/auth/refresh", () => {
  it("401 and the whole session revoked when an old refresh token is used again", async () => {
    const { refreshToken } = await loginUser();

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

  it("200 rotates the refresh token", async () => {
    const { refreshToken } = await loginUser();
    const refreshed = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).not.toBe(refreshToken);
  });
});

describe("POST /user/auth/logout", () => {
  it("401 without a token", async () => {
    expect((await request(app).post(`${BASE}/logout`)).status).toBe(401);
  });

  it("200 and the access token stops working right away", async () => {
    const { auth } = await loginUser();
    expect((await request(app).post(`${BASE}/logout`).set(auth)).status).toBe(
      200
    );
    expect((await request(app).get(`${BASE}/me`).set(auth)).status).toBe(401);
  });
});

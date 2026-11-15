// Log-in helpers shared by every test file. Each one goes through the real HTTP routes.
import request from "supertest";
import type { PageName } from "../../src/config/rbac.config.js";
import { createAdmin, createSuperAdmin, TEST_PASSWORD } from "./fixtures.js";
import { app, otpSender, redis } from "./testApp.js";

export const ADMIN_LOGIN = "/api/v1/admin/auth/login";
export const TEST_PHONE = "+919812345678";

/** Headers that send an access token the way the mobile app and API clients do. */
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** POST /admin/auth/login and return the raw response. */
export const loginAdmin = (email: string, password = TEST_PASSWORD) =>
  request(app).post(ADMIN_LOGIN).send({ email, password });

/** Creates an admin whose role may open the given pages, and logs them in. */
export async function adminWith(pages: PageName[], email = "staff@buddy.test") {
  const created = await createAdmin({ email, pages });
  const res = await loginAdmin(email);
  const token = res.body.data.accessToken as string;
  return { ...created, token, auth: bearer(token) };
}

/** Creates a SUPER_ADMIN and logs them in. */
export async function superAdmin() {
  const created = await createSuperAdmin();
  const res = await loginAdmin(created.admin.email);
  const token = res.body.data.accessToken as string;
  return { ...created, token, auth: bearer(token) };
}

/** Requests an OTP for the phone and logs in with it. Creates the user on first login. */
export async function loginUser(phone = TEST_PHONE) {
  // Allows several logins for the same phone inside one test.
  await redis.del(`otp:cooldown:${phone}`);
  await request(app).post("/api/v1/user/auth/otp/request").send({ phone });
  const res = await request(app)
    .post("/api/v1/user/auth/otp/verify")
    .send({ phone, otp: otpSender.codes.get(phone) });
  const data = res.body.data as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; phone: string };
  };
  return { ...data, auth: bearer(data.accessToken) };
}

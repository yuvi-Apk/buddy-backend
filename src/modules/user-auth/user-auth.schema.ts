import { z } from "zod";

// International format: "+" then country code and number, e.g. +919812345678.
const phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +919812345678");

export const requestOtpBody = z.strictObject({ phone });
export type RequestOtpBody = z.infer<typeof requestOtpBody>;

export const verifyOtpBody = z.strictObject({
  phone,
  otp: z.string().regex(/^\d{6}$/, "The code has 6 digits"),
});
export type VerifyOtpBody = z.infer<typeof verifyOtpBody>;

export const userRefreshBody = z.strictObject({
  refreshToken: z.string().min(1).max(200),
});
export type UserRefreshBody = z.infer<typeof userRefreshBody>;

// The logged-in app user, attached to the request as req.user by verifyUser.
export interface AuthenticatedUser {
  id: string;
  phone: string;
  name: string | null;
}

// The mobile app keeps both tokens in the device's secure storage.
export interface UserLoginResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthenticatedUser;
}

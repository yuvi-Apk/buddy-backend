import { z } from "zod";

export const adminLoginBody = z.strictObject({
  email: z.email().max(254).toLowerCase(),
  // No strength rules at login: any length mismatch would reveal the password policy.
  password: z.string().min(1).max(200),
});
export type AdminLoginBody = z.infer<typeof adminLoginBody>;

// The admin panel sends the refresh token as a cookie. A body value is accepted for API clients.
export const adminRefreshBody = z.strictObject({
  refreshToken: z.string().min(1).max(200).optional(),
});
export type AdminRefreshBody = z.infer<typeof adminRefreshBody>;

// The logged-in admin, attached to the request as req.adminUser by verifyAdmin.
export interface AuthenticatedAdmin {
  id: string;
  name: string;
  email: string;
  role: {
    id: string;
    name: string;
  };
}

export interface AdminLoginResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  admin: AuthenticatedAdmin;
}

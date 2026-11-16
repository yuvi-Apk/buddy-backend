import { z } from "zod";

// The ID token from "Sign in with Google" on the admin panel.
export const adminGoogleSignInBody = z.strictObject({
  idToken: z.string().min(1).max(4096),
});
export type AdminGoogleSignInBody = z.infer<typeof adminGoogleSignInBody>;

// The admin panel sends the refresh token as a cookie. A body value is accepted for API clients.
export const adminRefreshBody = z.strictObject({
  refreshToken: z.string().min(1).max(200).optional(),
});
export type AdminRefreshBody = z.infer<typeof adminRefreshBody>;

// The signed-in admin, attached to the request as req.admin by verifyAdmin.
export interface AuthenticatedAdmin {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: {
    id: string;
    name: string;
  };
}

export interface AdminSignInResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  admin: AuthenticatedAdmin;
}

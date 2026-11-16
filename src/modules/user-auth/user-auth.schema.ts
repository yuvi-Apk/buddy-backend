import { z } from "zod";

// The ID token from "Sign in with Google" in the app.
export const userGoogleSignInBody = z.strictObject({
  idToken: z.string().min(1).max(4096),
});
export type UserGoogleSignInBody = z.infer<typeof userGoogleSignInBody>;

export const userRefreshBody = z.strictObject({
  refreshToken: z.string().min(1).max(200),
});
export type UserRefreshBody = z.infer<typeof userRefreshBody>;

// The signed-in app user, attached to the request as req.user by verifyUser.
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  examCategory: "GOVERNMENT_EXAM" | "SCHOOL" | "COLLEGE" | "OTHER" | null;
}

// The app keeps both tokens in the device's secure storage.
export interface UserSignInResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthenticatedUser;
}

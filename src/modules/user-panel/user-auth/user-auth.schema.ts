import { z } from "zod";

// The ID token from "Sign in with Google" in the app.
export const userGoogleSignInBody = z.strictObject({
  idToken: z.string().min(1).max(4096),
});
export type UserGoogleSignInBody = z.infer<typeof userGoogleSignInBody>;

// The user panel sends the refresh token as a cookie. A body value is accepted for API clients.
export const userRefreshBody = z.strictObject({
  refreshToken: z.string().min(1).max(200).optional(),
});
export type UserRefreshBody = z.infer<typeof userRefreshBody>;

// The user's own profile change. Only the name; the photo has its own upload route.
export const updateUserProfileBody = z.strictObject({
  name: z.string().trim().min(1).max(80),
});
export type UpdateUserProfileBody = z.infer<typeof updateUserProfileBody>;

// The signed-in app user, attached to the request as req.user by verifyUser.
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  examCategory: "GOVERNMENT_EXAM" | "SCHOOL" | "COLLEGE" | "OTHER" | null;
}

// The controller puts the refresh token in an httpOnly cookie, never in the body.
export interface UserSignInResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthenticatedUser;
}

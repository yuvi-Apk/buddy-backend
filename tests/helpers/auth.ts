// Sign-in helpers shared by every test file. Each one goes through the real HTTP routes,
// with a fake Google ID token (see testApp.ts).
import request from "supertest";
import type { PageName } from "../../src/config/rbac.config.js";
import type { GoogleIdentity } from "../../src/core/security/GoogleIdTokenVerifier.js";
import { createAdmin, createSuperAdmin } from "./fixtures.js";
import { app, googleTokenVerifier } from "./testApp.js";

export const ADMIN_GOOGLE_SIGN_IN = "/api/v1/admin/auth/google";
export const USER_GOOGLE_SIGN_IN = "/api/v1/user/auth/google";

// Headers that send an access token the way the mobile app and API clients do.
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// A Google identity for an email. The Google account id is derived from the email, so the
// same email always signs in as the same Google account unless one is given.
export const googleIdentity = (
  email: string,
  overrides: Partial<GoogleIdentity> = {}
): GoogleIdentity => ({
  googleAccountId: `google-${email.toLowerCase()}`,
  email: email.toLowerCase(),
  name: "Google Name",
  avatarUrl: "https://lh3.googleusercontent.com/a/test-avatar",
  ...overrides,
});

export const googleIdTokenFor = (
  email: string,
  overrides: Partial<GoogleIdentity> = {}
) => googleTokenVerifier.issueIdToken(googleIdentity(email, overrides));

// POST /admin/auth/google and return the raw response.
export const signInAdmin = (
  email: string,
  overrides: Partial<GoogleIdentity> = {}
) =>
  request(app)
    .post(ADMIN_GOOGLE_SIGN_IN)
    .send({ idToken: googleIdTokenFor(email, overrides) });

// Creates an admin whose role may open the given pages, and signs them in.
export async function adminWith(pages: PageName[], email = "staff@buddy.test") {
  const created = await createAdmin({ email, pages });
  const res = await signInAdmin(email);
  const token = res.body.data.accessToken as string;
  return { ...created, token, auth: bearer(token) };
}

// Creates a SUPER_ADMIN and signs them in.
export async function superAdmin() {
  const created = await createSuperAdmin();
  const res = await signInAdmin(created.admin.email);
  const token = res.body.data.accessToken as string;
  return { ...created, token, auth: bearer(token) };
}

// POST /user/auth/google and return the raw response. Creates the user on first sign-in.
export const signInUserRequest = (
  email: string,
  overrides: Partial<GoogleIdentity> = {}
) =>
  request(app)
    .post(USER_GOOGLE_SIGN_IN)
    .send({ idToken: googleIdTokenFor(email, overrides) });

// Signs a user in (one device) and returns the tokens and profile.
export async function signInUser(email = "student@buddy.test") {
  const res = await signInUserRequest(email);
  const data = res.body.data as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string };
  };
  return { ...data, auth: bearer(data.accessToken) };
}

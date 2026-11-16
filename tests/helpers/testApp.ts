// Shared setup for integration tests: the real app, wired to the test Postgres and Redis.
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { redis } from "../../src/config/redis.js";
import { createContainer } from "../../src/container.js";
import type {
  GoogleIdentity,
  GoogleTokenVerifier,
} from "../../src/core/security/GoogleIdTokenVerifier.js";
import { ApiError } from "../../src/utils/ApiError.js";

// Stands in for Google: hands out ID tokens for test identities and accepts only those.
// The real verifier is tested on its own in tests/platform/google-id-token.test.ts.
class FakeGoogleTokenVerifier implements GoogleTokenVerifier {
  private readonly identitiesByToken = new Map<string, GoogleIdentity>();

  issueIdToken(identity: GoogleIdentity): string {
    const idToken = `fake-google-id-token-${randomUUID()}`;
    this.identitiesByToken.set(idToken, identity);
    return idToken;
  }

  verify(idToken: string): Promise<GoogleIdentity> {
    const identity = this.identitiesByToken.get(idToken);
    return identity
      ? Promise.resolve(identity)
      : Promise.reject(ApiError.unauthorized("Google sign-in failed"));
  }

  clear(): void {
    this.identitiesByToken.clear();
  }
}

export const googleTokenVerifier = new FakeGoogleTokenVerifier();
export const container = createContainer({ googleTokenVerifier });
export const app = createApp(container);
export { prisma, redis };

// Empties every table and the test Redis database. Call in beforeEach.
export async function resetState(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE uploads, sessions, invites, join_requests, classroom_members, classrooms, memberships, organizations, admin_permissions, admins, admin_roles, users CASCADE`;
  await redis.flushdb();
  googleTokenVerifier.clear();
}

// Closes connections. Call in afterAll.
export async function closeTestApp(): Promise<void> {
  await container.shutdown();
}

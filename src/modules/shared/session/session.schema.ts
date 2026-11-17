import { z } from "zod";

// Who a session belongs to: an admin or an app user.
export type SessionOwnerType = "ADMIN" | "USER";

export interface SessionOwner {
  type: SessionOwnerType;
  id: string;
}

// Request details saved with a session so people can recognise their devices.
export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

// Returned to the client after sign-in or refresh.
export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

// One device in "my devices". Never includes token hashes.
export interface SessionDto {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  deviceUserAgent: string | null;
  deviceIp: string | null;
}

export const sessionIdParams = z.strictObject({
  id: z.uuid(),
});
export type SessionIdParams = z.infer<typeof sessionIdParams>;

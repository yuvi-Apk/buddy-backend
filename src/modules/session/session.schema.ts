import { z } from "zod";

/** Who a session belongs to: an admin panel account or an app user. */
export type SubjectType = "ADMIN" | "USER";

export interface Subject {
  type: SubjectType;
  id: string;
}

/** Request details saved with a session so people can recognise their devices. */
export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

/** Returned to the client after login or refresh. */
export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export const sessionIdParams = z.strictObject({
  id: z.uuid(),
});
export type SessionIdParams = z.infer<typeof sessionIdParams>;

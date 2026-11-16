import type { Request } from "express";

// Request details saved with a session and used in security logs.
export const clientInfo = (req: Request) => ({
  userAgent: req.get("user-agent")?.slice(0, 255),
  ip: req.ip,
});

// Reads "Authorization: Bearer <token>". Returns undefined when absent or malformed.
export function bearerToken(req: Request): string | undefined {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

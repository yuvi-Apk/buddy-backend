// RULES.md #1: every route must carry a guard. A guard is either an auth middleware
// (verifyAdmin, verifyUser, requirePermission) or publicRoute() for routes that are open on purpose.
// tests/guardrails/route-guards.test.ts walks the route table and fails on any route without one.
import type { RequestHandler } from "express";

const GUARD_KIND = Symbol("routeGuardKind");

export type GuardKind = "public" | "admin" | "user" | "permission";

type MarkedHandler = RequestHandler & { [GUARD_KIND]?: GuardKind };

export function markGuard(
  handler: RequestHandler,
  kind: GuardKind
): RequestHandler {
  (handler as MarkedHandler)[GUARD_KIND] = kind;
  return handler;
}

export function guardKindOf(handler: unknown): GuardKind | undefined {
  return typeof handler === "function"
    ? (handler as MarkedHandler)[GUARD_KIND]
    : undefined;
}

// Marks a route as intentionally open to everyone (login, health check, ...).
export const publicRoute = (): RequestHandler =>
  markGuard((_req, _res, next) => next(), "public");

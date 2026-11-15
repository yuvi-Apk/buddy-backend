// RULES.md #1: every route must carry a guard. A guard is either an auth middleware
// (verifyAdmin, verifyUser, requirePermission) or publicRoute() for routes that are open on purpose.
// tests/guardrails/route-guards.test.ts walks the route table and fails on any route without one.
import type { RequestHandler } from "express";

const GUARD_KIND = Symbol("routeGuardKind");

export type GuardKind =
  | "public" // open to everyone on purpose
  | "admin" // verifyAdmin
  | "user" // verifyUser
  | "permission" // requirePermission / requireAnyPermission
  | "own-account"; // ownAccountRoute

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

// Marks an admin route that only touches the caller's own account (logout, my profile,
// my sessions). These need a login but no page permission. Every other admin route must
// use requirePermission(...).
export const ownAccountRoute = (): RequestHandler =>
  markGuard((_req, _res, next) => next(), "own-account");

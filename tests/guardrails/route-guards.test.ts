// RULES.md #1: no route without a guard.
// Walks every route registered under /api/v1 and checks its middleware chain.
import { afterAll, describe, expect, it } from "vitest";
import {
  guardKindOf,
  type GuardKind,
} from "../../src/middlewares/routeGuard.js";
import { createApiRouter } from "../../src/routes.js";
import { closeTestApp, container } from "../helpers/testApp.js";

interface Layer {
  handle: unknown;
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: unknown }[];
  };
}

interface RouteInfo {
  name: string;
  guards: GuardKind[];
}

function collectRoutes(router: unknown, found: RouteInfo[] = []): RouteInfo[] {
  const stack = (router as { stack?: Layer[] }).stack ?? [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(",").toUpperCase();
      found.push({
        name: `${methods} ${layer.route.path}`,
        guards: layer.route.stack
          .map((handler) => guardKindOf(handler.handle))
          .filter((kind): kind is GuardKind => kind !== undefined),
      });
    } else {
      collectRoutes(layer.handle, found); // a nested router
    }
  }
  return found;
}

const routes = collectRoutes(createApiRouter(container));

afterAll(closeTestApp);

describe("route guards", () => {
  it("finds the registered routes", () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it("every route is either public on purpose or requires a login", () => {
    const unguarded = routes.filter(
      (route) =>
        !route.guards.some((g) => ["public", "admin", "user"].includes(g))
    );
    expect(unguarded.map((route) => route.name)).toEqual([]);
  });

  it("no route is both public and login-protected", () => {
    const confused = routes.filter(
      (route) => route.guards.includes("public") && route.guards.length > 1
    );
    expect(confused.map((route) => route.name)).toEqual([]);
  });

  it("every admin route declares a page permission or is an own-account route", () => {
    const missing = routes.filter(
      (route) =>
        route.guards.includes("admin") &&
        !route.guards.includes("permission") &&
        !route.guards.includes("own-account")
    );
    expect(missing.map((route) => route.name)).toEqual([]);
  });

  it("the login guard always runs before the permission guard", () => {
    const wrongOrder = routes.filter((route) => {
      const login = route.guards.indexOf("admin");
      const permission = route.guards.indexOf("permission");
      return permission !== -1 && (login === -1 || login > permission);
    });
    expect(wrongOrder.map((route) => route.name)).toEqual([]);
  });
});

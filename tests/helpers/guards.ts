// Shared assertions for the guard checks every protected route needs.
import request from "supertest";
import { expect } from "vitest";
import type { PageName } from "../../src/config/rbac.config.js";
import { adminWith, loginUser } from "./auth.js";
import { app } from "./testApp.js";

export type Method = "get" | "post" | "patch" | "put" | "delete";
export type Route = [Method, string];

/** A valid UUID that matches no row. Use it in route paths for guard and 404 tests. */
export const MISSING_ID = "00000000-0000-4000-8000-000000000000";

/** Every route answers 401 without a token, and 401 for a user (app) token. */
export async function expectLoginRequired(routes: Route[]) {
  const user = await loginUser("+919800000099");
  for (const [method, path] of routes) {
    const anonymous = await request(app)[method](path);
    expect(anonymous.status, `${method} ${path} without a token`).toBe(401);

    const withUserToken = await request(app)[method](path).set(user.auth);
    expect(withUserToken.status, `${method} ${path} with a user token`).toBe(
      401
    );
  }
}

/**
 * Admin routes behind requirePermission(page): 401 without a login, and 403 for an admin
 * whose role does not have the page.
 */
export async function expectAdminPageRequired(routes: Route[], page: PageName) {
  await expectLoginRequired(routes);

  const noAccess = await adminWith([], `no-${page.toLowerCase()}@buddy.test`);
  for (const [method, path] of routes) {
    const res = await request(app)[method](path).set(noAccess.auth);
    expect(res.status, `${method} ${path} without the ${page} page`).toBe(403);
    expect(res.body.message).toBe("Forbidden: No permission");
  }
}

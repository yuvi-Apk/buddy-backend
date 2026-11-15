// Guard behaviour that is not tied to one module: requireAnyPermission, the permission
// cache, and keeping admin and user tokens apart.
import cookieParser from "cookie-parser";
import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { logger } from "../../src/config/logger.js";
import { errorHandler } from "../../src/utils/errorHandler.js";
import { adminWith, bearer, loginUser, superAdmin } from "../helpers/auth.js";
import {
  app,
  closeTestApp,
  container,
  redis,
  resetState,
} from "../helpers/testApp.js";

const ROLES = "/api/v1/admin/roles";

beforeEach(resetState);
afterAll(closeTestApp);

describe("requireAnyPermission", () => {
  // A tiny app with one route guarded by "ROLE or UPLOAD".
  const anyApp = express();
  anyApp.use(pinoHttp({ logger }));
  anyApp.use(cookieParser());
  anyApp.get(
    "/reports",
    container.guards.verifyAdmin,
    container.guards.requireAnyPermission(["ROLE", "UPLOAD"]),
    (_req, res) => {
      res.json({ ok: true });
    }
  );
  anyApp.use(errorHandler);

  it("401 when used without a login", async () => {
    expect((await request(anyApp).get("/reports")).status).toBe(401);
  });

  it("403 when the role has none of the pages", async () => {
    const none = await adminWith([], "none@buddy.test");
    expect((await request(anyApp).get("/reports").set(none.auth)).status).toBe(
      403
    );
  });

  it("passes when the role has one of the pages, and for SUPER_ADMIN", async () => {
    const staff = await adminWith(["UPLOAD"]);
    expect((await request(anyApp).get("/reports").set(staff.auth)).status).toBe(
      200
    );

    const boss = await superAdmin();
    expect((await request(anyApp).get("/reports").set(boss.auth)).status).toBe(
      200
    );
  });
});

describe("permission cache", () => {
  it("caches a role's pages in Redis", async () => {
    const { auth, role } = await adminWith(["ROLE"]);
    await request(app).get(ROLES).set(auth);
    expect(JSON.parse((await redis.get(`role-perms:${role.id}`))!)).toEqual([
      "ROLE",
    ]);
  });

  it("applies a permission change on the very next request", async () => {
    const staff = await adminWith(["ROLE"]);
    const boss = await superAdmin();

    expect((await request(app).get(ROLES).set(staff.auth)).status).toBe(200);

    const change = await request(app)
      .patch(`${ROLES}/${staff.role.id}`)
      .set(boss.auth)
      .send({ pages: ["UPLOAD"] });
    expect(change.status).toBe(200);

    expect((await request(app).get(ROLES).set(staff.auth)).status).toBe(403);

    // ...and granting it back works at once too.
    await request(app)
      .patch(`${ROLES}/${staff.role.id}`)
      .set(boss.auth)
      .send({ pages: ["ROLE", "UPLOAD"] });
    expect((await request(app).get(ROLES).set(staff.auth)).status).toBe(200);
  });
});

describe("admin and user tokens are not interchangeable", () => {
  it("rejects a user token on admin routes, in the header or the cookie", async () => {
    const { accessToken } = await loginUser();

    for (const path of ["/api/v1/admin/auth/me", "/api/v1/admin/sessions"]) {
      const viaHeader = await request(app).get(path).set(bearer(accessToken));
      expect(viaHeader.status).toBe(401);

      const viaCookie = await request(app)
        .get(path)
        .set("Cookie", `accessToken=${accessToken}`);
      expect(viaCookie.status).toBe(401);
    }
  });

  it("rejects an admin token on user routes", async () => {
    const { auth } = await adminWith([]);
    for (const path of ["/api/v1/user/auth/me", "/api/v1/user/sessions"]) {
      const res = await request(app).get(path).set(auth);
      expect(res.status).toBe(401);
    }
  });

  it("rejects a user refresh token on the admin refresh route", async () => {
    const { refreshToken } = await loginUser();
    const res = await request(app)
      .post("/api/v1/admin/auth/refresh")
      .send({ refreshToken });
    expect(res.status).toBe(401);
  });
});

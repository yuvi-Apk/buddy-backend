import cookieParser from "cookie-parser";
import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { logger } from "../src/config/logger.js";
import type { PageName } from "../src/config/rbac.config.js";
import { errorHandler } from "../src/utils/errorHandler.js";
import {
  createAdmin,
  createRole,
  createSuperAdmin,
  TEST_PASSWORD,
} from "./helpers/fixtures.js";
import {
  app,
  closeTestApp,
  container,
  prisma,
  redis,
  resetState,
} from "./helpers/testApp.js";

const ROLES = "/api/v1/admin/roles";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

beforeEach(resetState);
afterAll(closeTestApp);

async function tokenFor(email: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/admin/auth/login")
    .send({ email, password: TEST_PASSWORD });
  return res.body.data.accessToken as string;
}

/** Creates an admin whose role may access the given pages, and logs them in. */
async function adminWith(pages: PageName[], email = "staff@buddy.test") {
  const created = await createAdmin({ email, pages });
  return {
    ...created,
    auth: { Authorization: `Bearer ${await tokenFor(email)}` },
  };
}

async function superAdmin() {
  const created = await createSuperAdmin();
  return {
    ...created,
    auth: { Authorization: `Bearer ${await tokenFor(created.admin.email)}` },
  };
}

describe("admin routes are closed by default", () => {
  const roleRoutes: ["get" | "post" | "patch" | "delete", string][] = [
    ["get", ROLES],
    ["get", `${ROLES}/pages`],
    ["get", `${ROLES}/${MISSING_ID}`],
    ["post", ROLES],
    ["patch", `${ROLES}/${MISSING_ID}`],
    ["delete", `${ROLES}/${MISSING_ID}`],
  ];

  it("returns 401 on every role route without a token", async () => {
    for (const [method, path] of roleRoutes) {
      const res = await request(app)[method](path);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("returns 403 on every role route for an admin without the ROLE page", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    for (const [method, path] of roleRoutes) {
      const res = await request(app)[method](path).set(auth);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.message).toBe("Forbidden: No permission");
    }
  });

  it("lets an admin with the ROLE page in", async () => {
    const { auth } = await adminWith(["ROLE"]);
    expect((await request(app).get(ROLES).set(auth)).status).toBe(200);
  });

  it("lets SUPER_ADMIN in without any permission rows", async () => {
    const { auth, role } = await superAdmin();
    expect(
      await prisma.rolePermission.count({ where: { roleId: role.id } })
    ).toBe(0);
    expect((await request(app).get(ROLES).set(auth)).status).toBe(200);
  });

  it("ignores a permission row with isAccess = false", async () => {
    const { auth, role } = await adminWith([]);
    await prisma.rolePermission.create({
      data: { roleId: role.id, page: "ROLE", isAccess: false },
    });
    expect((await request(app).get(ROLES).set(auth)).status).toBe(403);
  });
});

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

  it("passes when the role has one of the pages", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    expect((await request(anyApp).get("/reports").set(auth)).status).toBe(200);
  });

  it("blocks when the role has none of them, and passes SUPER_ADMIN", async () => {
    const none = await adminWith([], "none@buddy.test");
    expect((await request(anyApp).get("/reports").set(none.auth)).status).toBe(
      403
    );

    const boss = await superAdmin();
    expect((await request(anyApp).get("/reports").set(boss.auth)).status).toBe(
      200
    );
  });

  it("returns 401 when used without a login", async () => {
    expect((await request(anyApp).get("/reports")).status).toBe(401);
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

describe("GET /admin/auth/me", () => {
  it("returns the pages the admin may access", async () => {
    const staff = await adminWith(["UPLOAD"]);
    const me = await request(app).get("/api/v1/admin/auth/me").set(staff.auth);
    expect(me.body.data.pages).toEqual(["UPLOAD"]);

    const boss = await superAdmin();
    const bossMe = await request(app)
      .get("/api/v1/admin/auth/me")
      .set(boss.auth);
    expect(bossMe.body.data.pages).toEqual(["ROLE", "UPLOAD"]);
  });
});

describe("role management", () => {
  it("creates a role with pages and returns it", async () => {
    const { auth } = await superAdmin();
    const res = await request(app)
      .post(ROLES)
      .set(auth)
      .send({
        name: "content_editor",
        description: "Edits content",
        pages: ["UPLOAD", "UPLOAD"],
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "CONTENT_EDITOR",
      description: "Edits content",
      pages: ["UPLOAD"],
    });
  });

  it("rejects an unknown page, a bad name and unknown fields", async () => {
    const { auth } = await superAdmin();
    const attempts = [
      { name: "EDITOR", pages: ["BILLING"] },
      { name: "x" },
      { name: "EDITOR", isSuperAdmin: true },
    ];
    for (const body of attempts) {
      const res = await request(app).post(ROLES).set(auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("rejects a duplicate name with 409 and the reserved SUPER_ADMIN name", async () => {
    const { auth } = await superAdmin();
    await request(app).post(ROLES).set(auth).send({ name: "EDITOR" });

    const duplicate = await request(app)
      .post(ROLES)
      .set(auth)
      .send({ name: "EDITOR" });
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).not.toMatch(/prisma|constraint/i);

    const reserved = await request(app)
      .post(ROLES)
      .set(auth)
      .send({ name: "SUPER_ADMIN" });
    expect(reserved.status).toBe(409);
  });

  it("lists roles with pagination and search", async () => {
    const { auth } = await superAdmin();
    for (const name of ["TEACHER", "TEACHING_ASSISTANT", "ACCOUNTANT"]) {
      await createRole(name);
    }

    const page = await request(app).get(`${ROLES}?page=1&limit=2`).set(auth);
    expect(page.status).toBe(200);
    expect(page.body.data.items).toHaveLength(2);
    expect(page.body.data.meta).toEqual({
      page: 1,
      limit: 2,
      total: 4,
      totalPages: 2,
    });

    const search = await request(app).get(`${ROLES}?search=teach`).set(auth);
    expect(search.body.data.items.map((r: { name: string }) => r.name)).toEqual(
      ["TEACHER", "TEACHING_ASSISTANT"]
    );

    const tooBig = await request(app).get(`${ROLES}?limit=101`).set(auth);
    expect(tooBig.status).toBe(400);
  });

  it("lists the pages that can be granted", async () => {
    const { auth } = await superAdmin();
    const res = await request(app).get(`${ROLES}/pages`).set(auth);
    expect(res.body.data).toEqual(["ROLE", "UPLOAD"]);
  });

  it("returns 404 for a missing role and 400 for a malformed ID", async () => {
    const { auth } = await superAdmin();
    expect(
      (await request(app).get(`${ROLES}/${MISSING_ID}`).set(auth)).status
    ).toBe(404);
    expect(
      (await request(app).get(`${ROLES}/not-a-uuid`).set(auth)).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`${ROLES}/${MISSING_ID}`)
          .set(auth)
          .send({ name: "X1" })
      ).status
    ).toBe(404);
  });

  it("requires at least one field on update", async () => {
    const { auth } = await superAdmin();
    const role = await createRole("EDITOR");
    const res = await request(app)
      .patch(`${ROLES}/${role.id}`)
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
  });

  it("never lets anyone change or delete the SUPER_ADMIN role", async () => {
    const { auth, role } = await superAdmin();
    const staff = await adminWith(["ROLE"]);

    for (const who of [auth, staff.auth]) {
      const patch = await request(app)
        .patch(`${ROLES}/${role.id}`)
        .set(who)
        .send({ name: "DEMOTED" });
      expect(patch.status).toBe(403);
      expect(
        (await request(app).delete(`${ROLES}/${role.id}`).set(who)).status
      ).toBe(403);
    }
  });

  it("stops an admin from changing their own role (no self-granted access)", async () => {
    const staff = await adminWith(["ROLE"]);
    const res = await request(app)
      .patch(`${ROLES}/${staff.role.id}`)
      .set(staff.auth)
      .send({ pages: ["ROLE", "UPLOAD"] });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You cannot change your own role");
  });

  it("refuses to delete a role that admins still hold, and deletes an unused one", async () => {
    const { auth } = await superAdmin();
    const staff = await adminWith(["UPLOAD"]);

    const inUse = await request(app)
      .delete(`${ROLES}/${staff.role.id}`)
      .set(auth);
    expect(inUse.status).toBe(409);

    const unused = await createRole("TEMP");
    expect(
      (await request(app).delete(`${ROLES}/${unused.id}`).set(auth)).status
    ).toBe(200);
    expect(
      await prisma.role.findUnique({ where: { id: unused.id } })
    ).toBeNull();
  });
});

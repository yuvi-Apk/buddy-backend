// /admin/roles: role management for the admin panel. Every route needs the ROLE page.
// Each describe block is one endpoint, in the order: guards → 400 → 404 → rule failures → success.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminWith, superAdmin } from "../helpers/auth.js";
import { createRole } from "../helpers/fixtures.js";
import {
  expectAdminPageRequired,
  MISSING_ID,
  type Route,
} from "../helpers/guards.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const ROLES = "/api/v1/admin/roles";

beforeEach(resetState);
afterAll(closeTestApp);

describe("guards on /admin/roles", () => {
  const routes: Route[] = [
    ["get", ROLES],
    ["get", `${ROLES}/pages`],
    ["get", `${ROLES}/${MISSING_ID}`],
    ["post", ROLES],
    ["patch", `${ROLES}/${MISSING_ID}`],
    ["delete", `${ROLES}/${MISSING_ID}`],
  ];

  it("401 without a login and 403 without the ROLE page, on every route", async () => {
    await expectAdminPageRequired(routes, "ROLE");
  });

  it("lets an admin with the ROLE page in", async () => {
    const { auth } = await adminWith(["ROLE"]);
    expect((await request(app).get(ROLES).set(auth)).status).toBe(200);
  });

  it("lets SUPER_ADMIN in without any permission rows", async () => {
    const { auth, role } = await superAdmin();
    expect(
      await prisma.adminPermission.count({ where: { roleId: role.id } })
    ).toBe(0);
    expect((await request(app).get(ROLES).set(auth)).status).toBe(200);
  });

  it("ignores a permission row with canAccess = false", async () => {
    const { auth, role } = await adminWith([]);
    await prisma.adminPermission.create({
      data: { roleId: role.id, pageName: "ROLE", canAccess: false },
    });
    expect((await request(app).get(ROLES).set(auth)).status).toBe(403);
  });
});

describe("GET /admin/roles", () => {
  it("400 for a page size above 100", async () => {
    const { auth } = await superAdmin();
    const res = await request(app).get(`${ROLES}?limit=101`).set(auth);
    expect(res.status).toBe(400);
  });

  it("200 lists roles with pagination metadata", async () => {
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
  });

  it("200 filters by search text", async () => {
    const { auth } = await superAdmin();
    for (const name of ["TEACHER", "TEACHING_ASSISTANT", "ACCOUNTANT"]) {
      await createRole(name);
    }
    const search = await request(app).get(`${ROLES}?search=teach`).set(auth);
    expect(search.body.data.items.map((r: { name: string }) => r.name)).toEqual(
      ["TEACHER", "TEACHING_ASSISTANT"]
    );
  });
});

describe("GET /admin/roles/pages", () => {
  it("200 lists the pages that can be granted", async () => {
    const { auth } = await superAdmin();
    const res = await request(app).get(`${ROLES}/pages`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(["ROLE", "UPLOAD"]);
  });
});

describe("GET /admin/roles/:id", () => {
  it("400 for a malformed ID", async () => {
    const { auth } = await superAdmin();
    const res = await request(app).get(`${ROLES}/not-a-uuid`).set(auth);
    expect(res.status).toBe(400);
  });

  it("404 for a missing role", async () => {
    const { auth } = await superAdmin();
    const res = await request(app).get(`${ROLES}/${MISSING_ID}`).set(auth);
    expect(res.status).toBe(404);
  });

  it("200 returns the role with its pages", async () => {
    const { auth } = await superAdmin();
    const role = await createRole("EDITOR", ["UPLOAD"]);
    const res = await request(app).get(`${ROLES}/${role.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "EDITOR", pages: ["UPLOAD"] });
  });
});

describe("POST /admin/roles", () => {
  it("400 for an unknown page, a bad name and unknown fields", async () => {
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

  it("409 for a duplicate name, without database details", async () => {
    const { auth } = await superAdmin();
    await request(app).post(ROLES).set(auth).send({ name: "EDITOR" });

    const duplicate = await request(app)
      .post(ROLES)
      .set(auth)
      .send({ name: "EDITOR" });
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).not.toMatch(/prisma|constraint/i);
  });

  it("409 for the reserved SUPER_ADMIN name", async () => {
    const { auth } = await superAdmin();
    const reserved = await request(app)
      .post(ROLES)
      .set(auth)
      .send({ name: "SUPER_ADMIN" });
    expect(reserved.status).toBe(409);
  });

  it("201 creates a role with pages and returns it", async () => {
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
});

describe("PATCH /admin/roles/:id", () => {
  it("400 when no field is sent", async () => {
    const { auth } = await superAdmin();
    const role = await createRole("EDITOR");
    const res = await request(app)
      .patch(`${ROLES}/${role.id}`)
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
  });

  it("404 for a missing role", async () => {
    const { auth } = await superAdmin();
    const res = await request(app)
      .patch(`${ROLES}/${MISSING_ID}`)
      .set(auth)
      .send({ name: "X1" });
    expect(res.status).toBe(404);
  });

  it("403 for the SUPER_ADMIN role, even for a super admin", async () => {
    const boss = await superAdmin();
    const staff = await adminWith(["ROLE"]);
    for (const who of [boss.auth, staff.auth]) {
      const res = await request(app)
        .patch(`${ROLES}/${boss.role.id}`)
        .set(who)
        .send({ name: "DEMOTED" });
      expect(res.status).toBe(403);
    }
  });

  it("403 when an admin tries to change their own role", async () => {
    const staff = await adminWith(["ROLE"]);
    const res = await request(app)
      .patch(`${ROLES}/${staff.role.id}`)
      .set(staff.auth)
      .send({ pages: ["ROLE", "UPLOAD"] });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You cannot change your own role");
  });

  it("200 replaces the role's pages", async () => {
    const { auth } = await superAdmin();
    const role = await createRole("EDITOR", ["ROLE"]);
    const res = await request(app)
      .patch(`${ROLES}/${role.id}`)
      .set(auth)
      .send({ pages: ["UPLOAD"] });
    expect(res.status).toBe(200);
    expect(res.body.data.pages).toEqual(["UPLOAD"]);
  });
});

describe("DELETE /admin/roles/:id", () => {
  it("403 for the SUPER_ADMIN role", async () => {
    const boss = await superAdmin();
    const staff = await adminWith(["ROLE"]);
    for (const who of [boss.auth, staff.auth]) {
      const res = await request(app)
        .delete(`${ROLES}/${boss.role.id}`)
        .set(who);
      expect(res.status).toBe(403);
    }
  });

  it("409 while admins still hold the role", async () => {
    const { auth } = await superAdmin();
    const staff = await adminWith(["UPLOAD"]);
    const res = await request(app)
      .delete(`${ROLES}/${staff.role.id}`)
      .set(auth);
    expect(res.status).toBe(409);
  });

  it("200 deletes an unused role", async () => {
    const { auth } = await superAdmin();
    const unused = await createRole("TEMP");
    const res = await request(app).delete(`${ROLES}/${unused.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(
      await prisma.adminRole.findUnique({ where: { id: unused.id } })
    ).toBeNull();
  });
});

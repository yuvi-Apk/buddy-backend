// /admin/admins: super admin panel staff accounts. Every route needs the ADMIN page.
// Nobody can grant or manage more access than they have; one active super admin always remains.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminWith, bearer, signInAdmin, superAdmin } from "../helpers/auth.js";
import { createAdmin, createRole } from "../helpers/fixtures.js";
import {
  expectAdminPageRequired,
  MISSING_ID,
  type Route,
} from "../helpers/guards.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const ADMINS = "/api/v1/admin/admins";
const ME = "/api/v1/admin/auth/me";

beforeEach(resetState);
afterAll(closeTestApp);

// Another account with the existing SUPER_ADMIN role, signed in.
async function secondSuperAdmin(superAdminRoleId: string) {
  const admin = await prisma.admin.create({
    data: {
      name: "Second Boss",
      email: "boss2@buddy.test",
      roleId: superAdminRoleId,
    },
  });
  const res = await signInAdmin(admin.email);
  return { admin, auth: bearer(res.body.data.accessToken as string) };
}

const adminRow = (adminId: string) =>
  prisma.admin.findUniqueOrThrow({ where: { id: adminId } });

describe("guards on /admin/admins", () => {
  const routes: Route[] = [
    ["get", ADMINS],
    ["post", ADMINS],
    ["get", `${ADMINS}/${MISSING_ID}`],
    ["patch", `${ADMINS}/${MISSING_ID}`],
  ];

  it("401 without a login and 403 without the ADMIN page, on every route", async () => {
    await expectAdminPageRequired(routes, "ADMIN");
  });

  it("lets an admin with the ADMIN page in", async () => {
    const { auth } = await adminWith(["ADMIN"]);
    expect((await request(app).get(ADMINS).set(auth)).status).toBe(200);
  });
});

describe("GET /admin/admins", () => {
  it("400 for a page size above 100", async () => {
    const { auth } = await superAdmin();
    const res = await request(app).get(`${ADMINS}?limit=101`).set(auth);
    expect(res.status).toBe(400);
  });

  it("200 lists with pagination, search and filters, without the Google account id", async () => {
    const { auth, admin: boss } = await superAdmin();
    const { admin: editor, role: editorRole } = await createAdmin({
      email: "editor@buddy.test",
    });
    await createAdmin({ email: "retired@buddy.test", isActive: false });

    const page = await request(app).get(`${ADMINS}?limit=2`).set(auth);
    expect(page.status).toBe(200);
    expect(page.body.data.meta).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(JSON.stringify(page.body)).not.toContain("googleAccountId");

    const byRole = await request(app)
      .get(`${ADMINS}?roleId=${editorRole.id}&isActive=true&search=EDIT`)
      .set(auth);
    expect(byRole.body.data.items).toHaveLength(1);
    expect(byRole.body.data.items[0]).toMatchObject({
      id: editor.id,
      isGoogleLinked: false,
      role: { id: editorRole.id },
    });

    const me = await request(app).get(`${ADMINS}/${boss.id}`).set(auth);
    expect(me.body.data.isGoogleLinked).toBe(true);
  });
});

describe("GET /admin/admins/:id", () => {
  it("400 for a malformed ID and 404 for a missing one", async () => {
    const { auth } = await superAdmin();
    expect((await request(app).get(`${ADMINS}/nope`).set(auth)).status).toBe(
      400
    );
    expect(
      (await request(app).get(`${ADMINS}/${MISSING_ID}`).set(auth)).status
    ).toBe(404);
  });
});

describe("POST /admin/admins", () => {
  it("400 for a bad email, a missing role, unknown fields and an unknown role", async () => {
    const { auth } = await superAdmin();
    const role = await createRole("EDITOR");
    const attempts = [
      { name: "New Staff", email: "nope", roleId: role.id },
      { name: "New Staff", email: "new@buddy.test" },
      {
        name: "New Staff",
        email: "new@buddy.test",
        roleId: role.id,
        isActive: false,
      },
      {
        name: "New Staff",
        email: "new@buddy.test",
        roleId: role.id,
        googleAccountId: "x",
      },
      { name: "New Staff", email: "new@buddy.test", roleId: MISSING_ID },
    ];
    for (const body of attempts) {
      const res = await request(app).post(ADMINS).set(auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.admin.count()).toBe(1);
  });

  it("409 for an email that is already used, in any letter case", async () => {
    const { auth, role } = await superAdmin();
    await createAdmin({ email: "staff@buddy.test" });
    const res = await request(app)
      .post(ADMINS)
      .set(auth)
      .send({ name: "Copy", email: "STAFF@buddy.test", roleId: role.id });
    expect(res.status).toBe(409);
  });

  it("403 when staff grant SUPER_ADMIN or a role with pages they don't have", async () => {
    const { role: superAdminRole } = await superAdmin();
    const staff = await adminWith(["ADMIN"], "staff@buddy.test");
    const uploader = await createRole("UPLOADER", ["UPLOAD"]);

    for (const roleId of [superAdminRole.id, uploader.id]) {
      const res = await request(app)
        .post(ADMINS)
        .set(staff.auth)
        .send({ name: "New Staff", email: "new@buddy.test", roleId });
      expect(res.status, roleId).toBe(403);
    }
    expect(
      await prisma.admin.count({ where: { email: "new@buddy.test" } })
    ).toBe(0);
  });

  it("201 staff grant a role within their own pages; the new admin signs in with Google", async () => {
    const staff = await adminWith(["ADMIN", "UPLOAD"], "staff@buddy.test");
    const uploader = await createRole("UPLOADER", ["UPLOAD"]);

    const res = await request(app).post(ADMINS).set(staff.auth).send({
      name: "New Uploader",
      email: "New@Buddy.test",
      roleId: uploader.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "New Uploader",
      email: "new@buddy.test",
      isActive: true,
      isGoogleLinked: false,
      role: { id: uploader.id, name: "UPLOADER" },
    });

    const signIn = await signInAdmin("new@buddy.test");
    expect(signIn.status).toBe(200);
    expect((await adminRow(res.body.data.id)).googleAccountId).not.toBeNull();
  });

  it("201 a super admin may create another super admin", async () => {
    const { auth, role } = await superAdmin();
    const res = await request(app)
      .post(ADMINS)
      .set(auth)
      .send({ name: "Deputy", email: "deputy@buddy.test", roleId: role.id });
    expect(res.status).toBe(201);
    expect(res.body.data.role.name).toBe("SUPER_ADMIN");
  });
});

describe("PATCH /admin/admins/:id", () => {
  const patch = (
    auth: Record<string, string>,
    adminId: string,
    body: Record<string, unknown>
  ) => request(app).patch(`${ADMINS}/${adminId}`).set(auth).send(body);

  it("400 for an empty body, an email change, a malformed ID and an unknown role", async () => {
    const { auth } = await superAdmin();
    const { admin } = await createAdmin();
    const attempts: [string, Record<string, unknown>][] = [
      [admin.id, {}],
      [admin.id, { email: "other@buddy.test" }],
      ["nope", { name: "Renamed" }],
      [admin.id, { roleId: MISSING_ID }],
    ];
    for (const [adminId, body] of attempts) {
      const res = await patch(auth, adminId, body);
      expect(res.status, `${adminId} ${JSON.stringify(body)}`).toBe(400);
    }
  });

  it("404 for a missing admin", async () => {
    const { auth } = await superAdmin();
    expect((await patch(auth, MISSING_ID, { name: "Ghost" })).status).toBe(404);
  });

  it("403 for the caller's own account, even a super admin's", async () => {
    const { auth, admin } = await superAdmin();
    const res = await patch(auth, admin.id, { isActive: false });
    expect(res.status).toBe(403);
    expect((await adminRow(admin.id)).isActive).toBe(true);
  });

  it("403 when staff change a super admin, an admin with more access, or promote to SUPER_ADMIN", async () => {
    const { admin: boss, role: superAdminRole } = await superAdmin();
    const staff = await adminWith(["ADMIN"], "staff@buddy.test");
    const { admin: uploader } = await createAdmin({
      email: "uploader@buddy.test",
      pages: ["UPLOAD"],
    });
    const { admin: peer } = await createAdmin({
      email: "peer@buddy.test",
      pages: ["ADMIN"],
    });

    const attempts: [string, Record<string, unknown>][] = [
      [boss.id, { isActive: false }],
      [uploader.id, { isActive: false }],
      [peer.id, { roleId: superAdminRole.id }],
    ];
    for (const [adminId, body] of attempts) {
      const res = await patch(staff.auth, adminId, body);
      expect(res.status, `${adminId} ${JSON.stringify(body)}`).toBe(403);
    }
    expect((await adminRow(boss.id)).isActive).toBe(true);
    expect((await adminRow(peer.id)).roleId).not.toBe(superAdminRole.id);
  });

  it("200 renames and moves to another role; the new pages apply on the next request", async () => {
    const { auth } = await superAdmin();
    const staff = await adminWith(["UPLOAD"], "staff@buddy.test");
    const organizer = await createRole("ORGANIZER", ["ORGANIZATION"]);

    const res = await patch(auth, staff.admin.id, {
      name: "Renamed Staff",
      roleId: organizer.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "Renamed Staff",
      role: { name: "ORGANIZER" },
    });

    const me = await request(app).get(ME).set(staff.auth);
    expect(me.body.data.pages).toEqual(["ORGANIZATION"]);
  });

  it("200 disabling signs the admin out at once and blocks sign-in; enabling lets them back", async () => {
    const { auth } = await superAdmin();
    const staff = await adminWith(["UPLOAD"], "staff@buddy.test");

    const disabled = await patch(auth, staff.admin.id, { isActive: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.isActive).toBe(false);
    expect((await request(app).get(ME).set(staff.auth)).status).toBe(401);
    expect((await signInAdmin("staff@buddy.test")).status).toBe(401);
    expect(
      await prisma.session.count({
        where: { adminId: staff.admin.id, revokedAt: null },
      })
    ).toBe(0);

    await patch(auth, staff.admin.id, { isActive: true });
    expect((await signInAdmin("staff@buddy.test")).status).toBe(200);
  });

  it("two super admins disabling each other at once leave one active super admin", async () => {
    const boss = await superAdmin();
    const deputy = await secondSuperAdmin(boss.role.id);

    const results = await Promise.all([
      patch(boss.auth, deputy.admin.id, { isActive: false }),
      patch(deputy.auth, boss.admin.id, { isActive: false }),
    ]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses[0]).toBe(200);
    // The loser is refused by the last-super-admin rule (409), or was already signed out (401).
    expect([401, 409]).toContain(statuses[1]);
    expect(
      await prisma.admin.count({
        where: { isActive: true, role: { name: "SUPER_ADMIN" } },
      })
    ).toBe(1);
  });

  it("two super admins demoting each other at once leave one super admin", async () => {
    const boss = await superAdmin();
    const deputy = await secondSuperAdmin(boss.role.id);
    const editor = await createRole("EDITOR");

    const results = await Promise.all([
      patch(boss.auth, deputy.admin.id, { roleId: editor.id }),
      patch(deputy.auth, boss.admin.id, { roleId: editor.id }),
    ]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses[0]).toBe(200);
    // The loser is refused by the last-super-admin rule (409), or already lost the ADMIN page (403).
    expect([403, 409]).toContain(statuses[1]);
    expect(
      await prisma.admin.count({ where: { role: { name: "SUPER_ADMIN" } } })
    ).toBe(1);
  });
});

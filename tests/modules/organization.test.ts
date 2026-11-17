// Organizations: the admin panel (/admin/organizations, /admin/users/:userId/membership-settings)
// and the app (/user/organizations). Admin routes need the ORGANIZATION page; app "/current"
// routes need a membership in the X-Organization-Id organization.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminWith, signInUser, superAdmin } from "../helpers/auth.js";
import {
  addMembership,
  addToClassroom,
  createClassroom,
  createOrganization,
  createSchoolWithMembers,
  createUser,
} from "../helpers/fixtures.js";
import {
  expectAdminPageRequired,
  MISSING_ID,
  type Route,
} from "../helpers/guards.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const ORGANIZATIONS = "/api/v1/admin/organizations";
const USERS = "/api/v1/admin/users";
const MY_ORGANIZATIONS = "/api/v1/user/organizations";
const CURRENT = `${MY_ORGANIZATIONS}/current`;
const JOIN_CODE_FORMAT = /^[A-HJ-NP-Z2-9]{8}$/;

beforeEach(resetState);
afterAll(closeTestApp);

const counters = async (organizationId: string, userId: string) => ({
  activeMemberCount: (
    await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    })
  ).activeMemberCount,
  activeMembershipCount: (
    await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  ).activeMembershipCount,
});

const inOrganization = (organizationId: string) => ({
  "X-Organization-Id": organizationId,
});

// ===========================================================================
// Admin panel
// ===========================================================================

describe("guards on admin organization routes", () => {
  const routes: Route[] = [
    ["get", ORGANIZATIONS],
    ["post", ORGANIZATIONS],
    ["get", `${ORGANIZATIONS}/${MISSING_ID}`],
    ["patch", `${ORGANIZATIONS}/${MISSING_ID}`],
    ["post", `${ORGANIZATIONS}/${MISSING_ID}/join-code/regenerate`],
    ["get", `${ORGANIZATIONS}/${MISSING_ID}/members`],
    ["post", `${ORGANIZATIONS}/${MISSING_ID}/admins`],
    ["patch", `${USERS}/${MISSING_ID}/membership-settings`],
  ];

  it("401 without a login and 403 without the ORGANIZATION page, on every route", async () => {
    await expectAdminPageRequired(routes, "ORGANIZATION");
  });

  it("lets an admin with the ORGANIZATION page in", async () => {
    const { auth } = await adminWith(["ORGANIZATION"]);
    expect((await request(app).get(ORGANIZATIONS).set(auth)).status).toBe(200);
  });
});

describe("POST /admin/organizations", () => {
  it("400 for a bad slug, a zero seat limit, a missing name and unknown fields", async () => {
    const { auth } = await superAdmin();
    const attempts = [
      { name: "Green Valley", slug: "green valley!" },
      { name: "Green Valley", slug: "green-valley", maxMembers: 0 },
      { slug: "green-valley" },
      { name: "Green Valley", slug: "green-valley", activeMemberCount: 5 },
      { name: "Green Valley", slug: "green-valley", joinCode: "MINE1234" },
    ];
    for (const body of attempts) {
      const res = await request(app).post(ORGANIZATIONS).set(auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("409 for a duplicate slug, without database details", async () => {
    const { auth } = await superAdmin();
    const body = { name: "Green Valley", slug: "green-valley" };
    await request(app).post(ORGANIZATIONS).set(auth).send(body);
    const duplicate = await request(app)
      .post(ORGANIZATIONS)
      .set(auth)
      .send(body);
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).not.toMatch(/prisma|constraint/i);
  });

  it("201 creates the organization with a generated join code", async () => {
    const { auth, admin } = await superAdmin();
    const res = await request(app).post(ORGANIZATIONS).set(auth).send({
      name: "Green Valley School",
      slug: "Green-Valley",
      maxMembers: 500,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "Green Valley School",
      slug: "green-valley",
      type: "SCHOOL",
      maxMembers: 500,
      activeMemberCount: 0,
      isActive: true,
      isJoinCodeEnabled: true,
    });
    expect(res.body.data.joinCode).toMatch(JOIN_CODE_FORMAT);
    const row = await prisma.organization.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.createdByAdminId).toBe(admin.id);
  });
});

describe("GET /admin/organizations", () => {
  it("400 for a page size above 100", async () => {
    const { auth } = await superAdmin();
    const res = await request(app).get(`${ORGANIZATIONS}?limit=101`).set(auth);
    expect(res.status).toBe(400);
  });

  it("200 lists with pagination, search and the isActive filter", async () => {
    const { auth } = await superAdmin();
    await createOrganization({ name: "Green Valley" });
    await createOrganization({ name: "Blue Hills" });
    await createOrganization({ name: "Green Meadows", isActive: false });

    const page = await request(app)
      .get(`${ORGANIZATIONS}?page=1&limit=2`)
      .set(auth);
    expect(page.body.data.items).toHaveLength(2);
    expect(page.body.data.meta).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    const search = await request(app)
      .get(`${ORGANIZATIONS}?search=green&isActive=true`)
      .set(auth);
    expect(search.body.data.items.map((o: { name: string }) => o.name)).toEqual(
      ["Green Valley"]
    );
  });
});

describe("GET /admin/organizations/:id", () => {
  it("400 for a malformed ID and 404 for a missing one", async () => {
    const { auth } = await superAdmin();
    expect(
      (await request(app).get(`${ORGANIZATIONS}/not-a-uuid`).set(auth)).status
    ).toBe(400);
    expect(
      (await request(app).get(`${ORGANIZATIONS}/${MISSING_ID}`).set(auth))
        .status
    ).toBe(404);
  });

  it("200 returns the organization and no internal fields", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization({ name: "Green Valley" });
    const res = await request(app)
      .get(`${ORGANIZATIONS}/${organization.id}`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Green Valley");
    expect(res.body.data).not.toHaveProperty("createdByAdminId");
  });
});

describe("PATCH /admin/organizations/:id", () => {
  it("400 when no field is sent or a field is unknown", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    for (const body of [{}, { activeMemberCount: 0 }]) {
      const res = await request(app)
        .patch(`${ORGANIZATIONS}/${organization.id}`)
        .set(auth)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("404 for a missing organization", async () => {
    const { auth } = await superAdmin();
    const res = await request(app)
      .patch(`${ORGANIZATIONS}/${MISSING_ID}`)
      .set(auth)
      .send({ name: "New name" });
    expect(res.status).toBe(404);
  });

  it("409 when maxMembers would drop below the current member count", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    for (const user of [await createUser(), await createUser()]) {
      await addMembership(organization.id, user.id);
    }
    const res = await request(app)
      .patch(`${ORGANIZATIONS}/${organization.id}`)
      .set(auth)
      .send({ maxMembers: 1, name: "Not saved" });
    expect(res.status).toBe(409);
    const row = await prisma.organization.findUniqueOrThrow({
      where: { id: organization.id },
    });
    expect(row).toMatchObject({ maxMembers: null, name: organization.name });
  });

  it("200 changes the fields, including deactivating", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    const res = await request(app)
      .patch(`${ORGANIZATIONS}/${organization.id}`)
      .set(auth)
      .send({
        name: "Renamed",
        type: "COLLEGE",
        maxMembers: 10,
        isJoinCodeEnabled: false,
        isActive: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "Renamed",
      type: "COLLEGE",
      maxMembers: 10,
      isJoinCodeEnabled: false,
      isActive: false,
    });
  });
});

describe("POST /admin/organizations/:id/join-code/regenerate", () => {
  it("404 for a missing organization", async () => {
    const { auth } = await superAdmin();
    const res = await request(app)
      .post(`${ORGANIZATIONS}/${MISSING_ID}/join-code/regenerate`)
      .set(auth);
    expect(res.status).toBe(404);
  });

  it("200 replaces the join code", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    const res = await request(app)
      .post(`${ORGANIZATIONS}/${organization.id}/join-code/regenerate`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.joinCode).toMatch(JOIN_CODE_FORMAT);
    expect(res.body.data.joinCode).not.toBe(organization.joinCode);
  });
});

describe("GET /admin/organizations/:id/members", () => {
  it("404 for a missing organization", async () => {
    const { auth } = await superAdmin();
    const res = await request(app)
      .get(`${ORGANIZATIONS}/${MISSING_ID}/members`)
      .set(auth);
    expect(res.status).toBe(404);
  });

  it("200 lists only this organization's members, filtered by role", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    const otherOrganization = await createOrganization();
    const teacher = await createUser({ email: "teacher@buddy.test" });
    const student = await createUser();
    const studentOfOtherOrganization = await createUser();
    await addMembership(organization.id, teacher.id, { role: "TEACHER" });
    await addMembership(organization.id, student.id);
    await addMembership(otherOrganization.id, studentOfOtherOrganization.id);

    const all = await request(app)
      .get(`${ORGANIZATIONS}/${organization.id}/members`)
      .set(auth);
    expect(all.body.data.meta.total).toBe(2);

    const teachers = await request(app)
      .get(`${ORGANIZATIONS}/${organization.id}/members?role=TEACHER`)
      .set(auth);
    expect(teachers.body.data.items).toHaveLength(1);
    expect(teachers.body.data.items[0]).toMatchObject({
      role: "TEACHER",
      status: "ACTIVE",
      user: { id: teacher.id, email: "teacher@buddy.test" },
    });
    expect(teachers.body.data.items[0].user).not.toHaveProperty(
      "googleAccountId"
    );
  });
});

describe("POST /admin/organizations/:id/admins", () => {
  const addAdmin = (
    auth: Record<string, string>,
    organizationId: string,
    email: string
  ) =>
    request(app)
      .post(`${ORGANIZATIONS}/${organizationId}/admins`)
      .set(auth)
      .send({ email });

  it("400 for a bad email or unknown fields", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    for (const body of [
      { email: "not-an-email" },
      { email: "a@buddy.test", role: "STUDENT" },
    ]) {
      const res = await request(app)
        .post(`${ORGANIZATIONS}/${organization.id}/admins`)
        .set(auth)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("404 for a missing organization or an email with no app user", async () => {
    const { auth } = await superAdmin();
    const user = await createUser();
    expect((await addAdmin(auth, MISSING_ID, user.email)).status).toBe(404);

    const organization = await createOrganization();
    const unknown = await addAdmin(auth, organization.id, "nobody@buddy.test");
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toMatch(/sign in to the app/);
  });

  it("201 adds the user as ORGANIZATION_ADMIN and counts the seat on both sides", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    const user = await createUser({ email: "principal@buddy.test" });

    const res = await addAdmin(auth, organization.id, "Principal@Buddy.test");
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      role: "ORGANIZATION_ADMIN",
      status: "ACTIVE",
      joinMethod: "ADDED_BY_ADMIN",
      user: { id: user.id },
    });
    expect(await counters(organization.id, user.id)).toEqual({
      activeMemberCount: 1,
      activeMembershipCount: 1,
    });
  });

  it("200 promotes an ACTIVE member without counting a second seat", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    const teacher = await createUser();
    await addMembership(organization.id, teacher.id, { role: "TEACHER" });

    const res = await addAdmin(auth, organization.id, teacher.email);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("ORGANIZATION_ADMIN");
    expect(await counters(organization.id, teacher.id)).toEqual({
      activeMemberCount: 1,
      activeMembershipCount: 1,
    });
  });

  it("409 for a suspended member", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    const user = await createUser();
    await addMembership(organization.id, user.id, { status: "SUSPENDED" });
    expect((await addAdmin(auth, organization.id, user.email)).status).toBe(
      409
    );
  });

  it("201 reactivates a member who left, counting the seat again", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization();
    const user = await createUser();
    await addMembership(organization.id, user.id, { status: "LEFT" });

    const res = await addAdmin(auth, organization.id, user.email);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "ACTIVE", leftAt: null });
    expect(await prisma.membership.count()).toBe(1);
    expect(await counters(organization.id, user.id)).toEqual({
      activeMemberCount: 1,
      activeMembershipCount: 1,
    });
  });

  it("409 when the user is in another organization, unless canJoinMultipleOrganizations", async () => {
    const { auth } = await superAdmin();
    const firstSchool = await createOrganization();
    const secondSchool = await createOrganization();
    const user = await createUser();
    await addMembership(firstSchool.id, user.id);

    const refused = await addAdmin(auth, secondSchool.id, user.email);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/already in an organization/);
    expect(await counters(secondSchool.id, user.id)).toEqual({
      activeMemberCount: 0,
      activeMembershipCount: 1,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { canJoinMultipleOrganizations: true },
    });
    expect((await addAdmin(auth, secondSchool.id, user.email)).status).toBe(
      201
    );
  });

  it("409 when the organization is full or deactivated, and nothing is counted", async () => {
    const { auth } = await superAdmin();
    const fullSchool = await createOrganization({ maxMembers: 1 });
    await addMembership(fullSchool.id, (await createUser()).id);
    const closedSchool = await createOrganization({ isActive: false });
    const user = await createUser();

    const full = await addAdmin(auth, fullSchool.id, user.email);
    expect(full.status).toBe(409);
    expect(full.body.message).toMatch(/no free seats/);

    const closed = await addAdmin(auth, closedSchool.id, user.email);
    expect(closed.status).toBe(409);
    expect(closed.body.message).toMatch(/deactivated/);

    const { activeMembershipCount } = await counters(fullSchool.id, user.id);
    expect(activeMembershipCount).toBe(0);
  });

  it("never fills more seats than maxMembers under parallel requests", async () => {
    const { auth } = await superAdmin();
    const organization = await createOrganization({ maxMembers: 2 });
    const users = await Promise.all(
      Array.from({ length: 6 }, () => createUser())
    );

    const results = await Promise.all(
      users.map((user) => addAdmin(auth, organization.id, user.email))
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(2);
    expect(results.filter((res) => res.status === 409)).toHaveLength(4);
    const row = await prisma.organization.findUniqueOrThrow({
      where: { id: organization.id },
    });
    expect(row.activeMemberCount).toBe(2);
    expect(await prisma.membership.count()).toBe(2);
  });

  it("lets a user join only one organization under parallel requests", async () => {
    const { auth } = await superAdmin();
    const schools = await Promise.all(
      Array.from({ length: 4 }, () => createOrganization())
    );
    const user = await createUser();

    const results = await Promise.all(
      schools.map((school) => addAdmin(auth, school.id, user.email))
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.activeMembershipCount).toBe(1);
    expect(await prisma.membership.count()).toBe(1);
  });
});

describe("PATCH /admin/users/:userId/membership-settings", () => {
  const settingsOf = (userId: string) =>
    `${USERS}/${userId}/membership-settings`;

  it("400 for a malformed ID, a missing flag or unknown fields", async () => {
    const { auth } = await superAdmin();
    const user = await createUser();
    const attempts: [string, object][] = [
      [settingsOf("not-a-uuid"), { canJoinMultipleOrganizations: true }],
      [settingsOf(user.id), {}],
      [
        settingsOf(user.id),
        { canJoinMultipleOrganizations: true, activeMembershipCount: 0 },
      ],
    ];
    for (const [path, body] of attempts) {
      const res = await request(app).patch(path).set(auth).send(body);
      expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
    }
  });

  it("404 for a missing user", async () => {
    const { auth } = await superAdmin();
    const res = await request(app)
      .patch(settingsOf(MISSING_ID))
      .set(auth)
      .send({ canJoinMultipleOrganizations: true });
    expect(res.status).toBe(404);
  });

  it("200 turns the flag on and off", async () => {
    const { auth } = await superAdmin();
    const user = await createUser();
    await addMembership((await createOrganization()).id, user.id);

    const on = await request(app)
      .patch(settingsOf(user.id))
      .set(auth)
      .send({ canJoinMultipleOrganizations: true });
    expect(on.status).toBe(200);
    expect(on.body.data).toEqual({
      userId: user.id,
      canJoinMultipleOrganizations: true,
      activeMembershipCount: 1,
    });

    const off = await request(app)
      .patch(settingsOf(user.id))
      .set(auth)
      .send({ canJoinMultipleOrganizations: false });
    expect(off.status).toBe(200);
    expect(off.body.data.canJoinMultipleOrganizations).toBe(false);
  });

  it("409 turning the flag off while the user is in several organizations", async () => {
    const { auth } = await superAdmin();
    const user = await createUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { canJoinMultipleOrganizations: true },
    });
    await addMembership((await createOrganization()).id, user.id);
    await addMembership((await createOrganization()).id, user.id);

    const res = await request(app)
      .patch(settingsOf(user.id))
      .set(auth)
      .send({ canJoinMultipleOrganizations: false });
    expect(res.status).toBe(409);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.canJoinMultipleOrganizations).toBe(true);
  });
});

// ===========================================================================
// App (user panel)
// ===========================================================================

describe("guards on app organization routes", () => {
  const routes: Route[] = [
    ["get", MY_ORGANIZATIONS],
    ["get", CURRENT],
    ["get", `${CURRENT}/join-code`],
    ["patch", `${CURRENT}/join-code`],
    ["post", `${CURRENT}/join-code/regenerate`],
    ["get", `${CURRENT}/members`],
    ["patch", `${CURRENT}/members/${MISSING_ID}`],
    ["delete", `${CURRENT}/members/${MISSING_ID}`],
    ["post", `${CURRENT}/leave`],
  ];

  it("401 without a token and with an admin token", async () => {
    const { auth: adminAuth } = await superAdmin();
    for (const [method, path] of routes) {
      expect((await request(app)[method](path)).status, path).toBe(401);
      expect(
        (await request(app)[method](path).set(adminAuth)).status,
        path
      ).toBe(401);
    }
  });

  it("400 without the X-Organization-Id header, or with a malformed one", async () => {
    const student = await signInUser();
    for (const headers of [{}, inOrganization("not-a-uuid")]) {
      const res = await request(app)
        .get(CURRENT)
        .set(student.auth)
        .set(headers);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/X-Organization-Id/);
    }
  });

  it("404 for an organization the user is not in, a missing one, a deactivated one, or one they left", async () => {
    const student = await signInUser();
    const otherSchool = await createOrganization();
    await addMembership(otherSchool.id, (await createUser()).id);
    const closedSchool = await createOrganization();
    await addMembership(closedSchool.id, student.user.id);
    await prisma.organization.update({
      where: { id: closedSchool.id },
      data: { isActive: false },
    });
    const formerSchool = await createOrganization();
    await addMembership(formerSchool.id, student.user.id, { status: "LEFT" });

    for (const organizationId of [
      otherSchool.id,
      MISSING_ID,
      closedSchool.id,
      formerSchool.id,
    ]) {
      const res = await request(app)
        .get(CURRENT)
        .set(student.auth)
        .set(inOrganization(organizationId));
      expect(res.status, organizationId).toBe(404);
    }
  });

  it("403 for a suspended member", async () => {
    const student = await signInUser();
    const school = await createOrganization();
    await addMembership(school.id, student.user.id, { status: "SUSPENDED" });
    const res = await request(app)
      .get(CURRENT)
      .set(student.auth)
      .set(inOrganization(school.id));
    expect(res.status).toBe(403);
  });

  it("403 for organization-admin routes when the member is a student or teacher", async () => {
    const school = await createOrganization();
    for (const role of ["STUDENT", "TEACHER"] as const) {
      const member = await signInUser(`${role.toLowerCase()}@buddy.test`);
      await addMembership(school.id, member.user.id, { role });
      const res = await request(app)
        .get(`${CURRENT}/join-code`)
        .set(member.auth)
        .set(inOrganization(school.id));
      expect(res.status, role).toBe(403);
    }
  });
});

describe("GET /user/organizations", () => {
  it("200 lists only the user's own seat-holding memberships in active organizations", async () => {
    const student = await signInUser();
    await prisma.user.update({
      where: { id: student.user.id },
      data: { canJoinMultipleOrganizations: true },
    });
    const school = await createOrganization({ name: "Green Valley" });
    const coaching = await createOrganization({ name: "Bright Coaching" });
    const formerSchool = await createOrganization();
    const closedSchool = await createOrganization({ isActive: false });
    const notMine = await createOrganization();
    await addMembership(school.id, student.user.id);
    await addMembership(coaching.id, student.user.id, { status: "SUSPENDED" });
    await addMembership(formerSchool.id, student.user.id, { status: "LEFT" });
    await addMembership(closedSchool.id, student.user.id);
    await addMembership(notMine.id, (await createUser()).id);

    const res = await request(app).get(MY_ORGANIZATIONS).set(student.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(2);
    expect(
      res.body.data.items.map(
        (item: { organization: { name: string } }) => item.organization.name
      )
    ).toEqual(["Green Valley", "Bright Coaching"]);
    expect(res.body.data.items[1].membership.status).toBe("SUSPENDED");
    expect(res.body.data.items[0].organization).not.toHaveProperty("joinCode");
  });

  it("400 for a page size above 100", async () => {
    const student = await signInUser();
    const res = await request(app)
      .get(`${MY_ORGANIZATIONS}?limit=101`)
      .set(student.auth);
    expect(res.status).toBe(400);
  });
});

describe("GET /user/organizations/current", () => {
  it("200 returns the organization and the caller's membership, without the join code", async () => {
    const teacher = await signInUser("teacher@buddy.test");
    const school = await createOrganization({ name: "Green Valley" });
    await addMembership(school.id, teacher.user.id, { role: "TEACHER" });

    const res = await request(app)
      .get(CURRENT)
      .set(teacher.auth)
      .set(inOrganization(school.id));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      organization: { id: school.id, name: "Green Valley" },
      membership: { role: "TEACHER", status: "ACTIVE" },
    });
    expect(JSON.stringify(res.body)).not.toContain(school.joinCode);
  });
});

describe("organization admin: /user/organizations/current/join-code", () => {
  async function organizationAdminOf(schoolName = "Green Valley") {
    const school = await createOrganization({ name: schoolName });
    const principal = await signInUser(
      `principal-${school.id.slice(-6)}@buddy.test`
    );
    await addMembership(school.id, principal.user.id, {
      role: "ORGANIZATION_ADMIN",
    });
    return { school, principal, headers: inOrganization(school.id) };
  }

  it("GET 200 returns the join code", async () => {
    const { school, principal, headers } = await organizationAdminOf();
    const res = await request(app)
      .get(`${CURRENT}/join-code`)
      .set(principal.auth)
      .set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      joinCode: school.joinCode,
      isJoinCodeEnabled: true,
    });
  });

  it("PATCH 400 for unknown fields, 200 turns the join code off", async () => {
    const { school, principal, headers } = await organizationAdminOf();
    const bad = await request(app)
      .patch(`${CURRENT}/join-code`)
      .set(principal.auth)
      .set(headers)
      .send({ isJoinCodeEnabled: false, joinCode: "MINE1234" });
    expect(bad.status).toBe(400);

    const res = await request(app)
      .patch(`${CURRENT}/join-code`)
      .set(principal.auth)
      .set(headers)
      .send({ isJoinCodeEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isJoinCodeEnabled).toBe(false);
    const row = await prisma.organization.findUniqueOrThrow({
      where: { id: school.id },
    });
    expect(row.isJoinCodeEnabled).toBe(false);
  });

  it("POST regenerate 200 replaces the join code", async () => {
    const { school, principal, headers } = await organizationAdminOf();
    const res = await request(app)
      .post(`${CURRENT}/join-code/regenerate`)
      .set(principal.auth)
      .set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data.joinCode).toMatch(JOIN_CODE_FORMAT);
    expect(res.body.data.joinCode).not.toBe(school.joinCode);
  });

  it("404 when an organization admin names another organization", async () => {
    const { principal } = await organizationAdminOf();
    const { school: otherSchool } = await organizationAdminOf("Blue Hills");
    const res = await request(app)
      .post(`${CURRENT}/join-code/regenerate`)
      .set(principal.auth)
      .set(inOrganization(otherSchool.id));
    expect(res.status).toBe(404);
    const row = await prisma.organization.findUniqueOrThrow({
      where: { id: otherSchool.id },
    });
    expect(row.joinCode).toBe(otherSchool.joinCode);
  });
});
// ===========================================================================
// App: member management and leaving
// ===========================================================================

const membershipOf = (membershipId: string) =>
  prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });

const countActiveOrganizationAdmins = () =>
  prisma.membership.count({
    where: { role: "ORGANIZATION_ADMIN", status: "ACTIVE" },
  });

describe("GET /user/organizations/current/members", () => {
  it("403 for a teacher or student", async () => {
    const { teacher, student } = await createSchoolWithMembers(signInUser);
    for (const member of [teacher, student]) {
      const res = await request(app)
        .get(`${CURRENT}/members`)
        .set(member.headers);
      expect(res.status).toBe(403);
    }
  });

  it("200 lists this organization's members with pagination", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    await createSchoolWithMembers(signInUser, "Blue Hills");
    const res = await request(app)
      .get(`${CURRENT}/members?limit=2&role=TEACHER`)
      .set(principal.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.meta).toMatchObject({ total: 1, limit: 2 });
    expect(res.body.data.items[0].role).toBe("TEACHER");
  });

  it("400 for a page size above 100", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const res = await request(app)
      .get(`${CURRENT}/members?limit=101`)
      .set(principal.headers);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /user/organizations/current/members/:membershipId", () => {
  const memberPath = (membershipId: string) =>
    `${CURRENT}/members/${membershipId}`;

  it("400 for an empty body, LEFT or REMOVED status, unknown fields and a malformed ID", async () => {
    const { principal, student } = await createSchoolWithMembers(signInUser);
    const attempts: [string, object][] = [
      [memberPath(student.membership.id), {}],
      [memberPath(student.membership.id), { status: "LEFT" }],
      [memberPath(student.membership.id), { status: "REMOVED" }],
      [memberPath(student.membership.id), { joinMethod: "ACCEPTED_INVITE" }],
      [memberPath("not-a-uuid"), { role: "TEACHER" }],
    ];
    for (const [path, body] of attempts) {
      const res = await request(app)
        .patch(path)
        .set(principal.headers)
        .send(body);
      expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
    }
  });

  it("403 for the caller's own membership", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const res = await request(app)
      .patch(memberPath(principal.membership.id))
      .set(principal.headers)
      .send({ role: "TEACHER" });
    expect(res.status).toBe(403);
    expect((await membershipOf(principal.membership.id)).role).toBe(
      "ORGANIZATION_ADMIN"
    );
  });

  it("404 for a member of another organization, one who left, or a missing one", async () => {
    const { principal, school } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const formerStudent = await addMembership(
      school.id,
      (await createUser()).id,
      { status: "LEFT" }
    );
    for (const membershipId of [
      other.student.membership.id,
      formerStudent.id,
      MISSING_ID,
    ]) {
      const res = await request(app)
        .patch(memberPath(membershipId))
        .set(principal.headers)
        .send({ status: "SUSPENDED" });
      expect(res.status, membershipId).toBe(404);
    }
    expect((await membershipOf(other.student.membership.id)).status).toBe(
      "ACTIVE"
    );
  });

  it("200 promotes a teacher and suspends a student, who is then locked out", async () => {
    const { principal, teacher, student } =
      await createSchoolWithMembers(signInUser);

    const promoted = await request(app)
      .patch(memberPath(teacher.membership.id))
      .set(principal.headers)
      .send({ role: "ORGANIZATION_ADMIN" });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.role).toBe("ORGANIZATION_ADMIN");

    const suspended = await request(app)
      .patch(memberPath(student.membership.id))
      .set(principal.headers)
      .send({ status: "SUSPENDED" });
    expect(suspended.status).toBe(200);
    expect((await request(app).get(CURRENT).set(student.headers)).status).toBe(
      403
    );
  });

  it("two admins demoting each other at once leave one admin", async () => {
    const { principal, teacher } = await createSchoolWithMembers(signInUser);
    await prisma.membership.update({
      where: { id: teacher.membership.id },
      data: { role: "ORGANIZATION_ADMIN" },
    });

    const results = await Promise.all([
      request(app)
        .patch(memberPath(teacher.membership.id))
        .set(principal.headers)
        .send({ role: "STUDENT" }),
      request(app)
        .patch(memberPath(principal.membership.id))
        .set(teacher.headers)
        .send({ role: "STUDENT" }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 403]);
    expect(await countActiveOrganizationAdmins()).toBe(1);
  });
});

describe("DELETE /user/organizations/current/members/:membershipId", () => {
  it("403 for the caller's own membership and for a non-admin", async () => {
    const { principal, teacher, student } =
      await createSchoolWithMembers(signInUser);
    const own = await request(app)
      .delete(`${CURRENT}/members/${principal.membership.id}`)
      .set(principal.headers);
    expect(own.status).toBe(403);
    const byTeacher = await request(app)
      .delete(`${CURRENT}/members/${student.membership.id}`)
      .set(teacher.headers);
    expect(byTeacher.status).toBe(403);
  });

  it("404 for a member of another organization", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const res = await request(app)
      .delete(`${CURRENT}/members/${other.student.membership.id}`)
      .set(principal.headers);
    expect(res.status).toBe(404);
    expect((await membershipOf(other.student.membership.id)).status).toBe(
      "ACTIVE"
    );
  });

  it("200 removes the member: seat freed, out of every classroom, locked out, and only once", async () => {
    const { school, principal, student } =
      await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    await addToClassroom(classroom, student.membership.id);

    const res = await request(app)
      .delete(`${CURRENT}/members/${student.membership.id}`)
      .set(principal.headers);
    expect(res.status).toBe(200);
    expect(await membershipOf(student.membership.id)).toMatchObject({
      status: "REMOVED",
      leftAt: expect.any(Date),
    });
    expect(await counters(school.id, student.user.id)).toEqual({
      activeMemberCount: 2,
      activeMembershipCount: 0,
    });
    expect(await prisma.classroomMember.count()).toBe(0);
    expect((await request(app).get(CURRENT).set(student.headers)).status).toBe(
      404
    );

    const again = await request(app)
      .delete(`${CURRENT}/members/${student.membership.id}`)
      .set(principal.headers);
    expect(again.status).toBe(404);
    expect((await counters(school.id, student.user.id)).activeMemberCount).toBe(
      2
    );
  });
});

describe("POST /user/organizations/current/leave", () => {
  it("409 for the only active organization admin", async () => {
    const { principal, school } = await createSchoolWithMembers(signInUser);
    const res = await request(app)
      .post(`${CURRENT}/leave`)
      .set(principal.headers);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/only organization admin/);
    expect(
      (await counters(school.id, principal.user.id)).activeMemberCount
    ).toBe(3);
  });

  it("200 a student leaves: seat freed, out of classrooms, and free to join another organization", async () => {
    const { school, student } = await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    await addToClassroom(classroom, student.membership.id);

    const res = await request(app)
      .post(`${CURRENT}/leave`)
      .set(student.headers);
    expect(res.status).toBe(200);
    expect((await membershipOf(student.membership.id)).status).toBe("LEFT");
    expect(await counters(school.id, student.user.id)).toEqual({
      activeMemberCount: 2,
      activeMembershipCount: 0,
    });
    expect(await prisma.classroomMember.count()).toBe(0);
    expect((await request(app).get(CURRENT).set(student.headers)).status).toBe(
      404
    );

    const { auth } = await superAdmin();
    const otherSchool = await createOrganization();
    const studentRow = await prisma.user.findUniqueOrThrow({
      where: { id: student.user.id },
    });
    const joined = await request(app)
      .post(`${ORGANIZATIONS}/${otherSchool.id}/admins`)
      .set(auth)
      .send({ email: studentRow.email });
    expect(joined.status).toBe(201);
  });

  it("200 an admin leaves while another admin stays", async () => {
    const { principal, teacher } = await createSchoolWithMembers(signInUser);
    await prisma.membership.update({
      where: { id: teacher.membership.id },
      data: { role: "ORGANIZATION_ADMIN" },
    });
    const res = await request(app)
      .post(`${CURRENT}/leave`)
      .set(principal.headers);
    expect(res.status).toBe(200);
  });

  it("two admins leaving at once: one leaves, one stays", async () => {
    const { principal, teacher } = await createSchoolWithMembers(signInUser);
    await prisma.membership.update({
      where: { id: teacher.membership.id },
      data: { role: "ORGANIZATION_ADMIN" },
    });
    const results = await Promise.all(
      [principal, teacher].map((admin) =>
        request(app).post(`${CURRENT}/leave`).set(admin.headers)
      )
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await countActiveOrganizationAdmins()).toBe(1);
  });
});

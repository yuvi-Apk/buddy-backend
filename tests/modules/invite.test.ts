// Invites (Way 1): an organization admin (/user/invites) or an admin
// (/admin/organizations/:organizationId/invites) invites an email; the person signs in with
// that Google account and accepts by link token or from their "received" list.
import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminWith, signInUser, superAdmin } from "../helpers/auth.js";
import {
  addMembership,
  createClassroom,
  createOrganization,
  createSchoolWithMembers,
} from "../helpers/fixtures.js";
import {
  expectAdminPageRequired,
  MISSING_ID,
  type Route,
} from "../helpers/guards.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const INVITES = "/api/v1/user/invites";
const ACCEPT = `${INVITES}/accept`;
const RECEIVED = `${INVITES}/received`;
const adminInvites = (organizationId: string) =>
  `/api/v1/admin/organizations/${organizationId}/invites`;

const INVITEE_EMAIL = "new.student@buddy.test";

beforeEach(resetState);
afterAll(closeTestApp);

const tokenFrom = (inviteLink: string) =>
  new URL(inviteLink).searchParams.get("token") as string;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// An organization admin invites an email and gets the link back.
async function sendInvite(
  headers: Record<string, string>,
  body: Record<string, unknown> = {}
) {
  const res = await request(app)
    .post(INVITES)
    .set(headers)
    .send({ inviteeEmail: INVITEE_EMAIL, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    invite: res.body.data.invite as { id: string },
    token: tokenFrom(res.body.data.inviteLink as string),
  };
}

const accept = (
  auth: Record<string, string>,
  token: string,
  body: Record<string, unknown> = {}
) =>
  request(app)
    .post(ACCEPT)
    .set(auth)
    .send({ token, ...body });

const inviteRow = (inviteId: string) =>
  prisma.invite.findUniqueOrThrow({ where: { id: inviteId } });

// ===========================================================================
// Guards
// ===========================================================================

describe("guards on invite routes", () => {
  const userRoutes: Route[] = [
    ["get", INVITES],
    ["post", INVITES],
    ["delete", `${INVITES}/${MISSING_ID}`],
    ["get", RECEIVED],
    ["post", ACCEPT],
    ["post", `${RECEIVED}/${MISSING_ID}/accept`],
  ];
  const adminRoutes: Route[] = [
    ["get", adminInvites(MISSING_ID)],
    ["post", adminInvites(MISSING_ID)],
    ["delete", `${adminInvites(MISSING_ID)}/${MISSING_ID}`],
  ];

  it("app routes: 401 without a token and with an admin token", async () => {
    const { auth: adminAuth } = await superAdmin();
    for (const [method, path] of userRoutes) {
      expect((await request(app)[method](path)).status, path).toBe(401);
      expect(
        (await request(app)[method](path).set(adminAuth)).status,
        path
      ).toBe(401);
    }
  });

  it("organization-admin routes: 400 without X-Organization-Id, 403 for teachers and students", async () => {
    const { teacher, student } = await createSchoolWithMembers(signInUser);
    const organizationAdminRoutes = userRoutes.slice(0, 3);
    for (const [method, path] of organizationAdminRoutes) {
      expect(
        (await request(app)[method](path).set(teacher.auth)).status,
        path
      ).toBe(400);
      for (const member of [teacher, student]) {
        const res = await request(app)[method](path).set(member.headers);
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    }
  });

  it("admin routes: 401 without a login and 403 without the ORGANIZATION page", async () => {
    await expectAdminPageRequired(adminRoutes, "ORGANIZATION");
  });
});

// ===========================================================================
// Organization admins
// ===========================================================================

describe("POST /user/invites", () => {
  it("400 for a bad email, an unknown role, a malformed classroom ID and unknown fields", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const attempts = [
      { inviteeEmail: "not-an-email" },
      { inviteeEmail: INVITEE_EMAIL, roleOnJoin: "OWNER" },
      { inviteeEmail: INVITEE_EMAIL, classroomId: "nope" },
      { inviteeEmail: INVITEE_EMAIL, organizationId: MISSING_ID },
      { inviteeEmail: INVITEE_EMAIL, tokenHash: "x" },
    ];
    for (const body of attempts) {
      const res = await request(app)
        .post(INVITES)
        .set(principal.headers)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("404 for another organization's classroom; 409 for an archived classroom", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const otherClassroom = await createClassroom(other.school.id);
    const archived = await createClassroom(school.id, { isArchived: true });

    const foreign = await request(app)
      .post(INVITES)
      .set(principal.headers)
      .send({ inviteeEmail: INVITEE_EMAIL, classroomId: otherClassroom.id });
    expect(foreign.status).toBe(404);

    const toArchived = await request(app)
      .post(INVITES)
      .set(principal.headers)
      .send({ inviteeEmail: INVITEE_EMAIL, classroomId: archived.id });
    expect(toArchived.status).toBe(409);
    expect(await prisma.invite.count()).toBe(0);
  });

  it("409 for a second pending invite to the same email, without database details", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    await sendInvite(principal.headers);
    const res = await request(app)
      .post(INVITES)
      .set(principal.headers)
      .send({ inviteeEmail: INVITEE_EMAIL.toUpperCase() });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|constraint/i);
  });

  it("201 once the earlier invite has expired, which is then marked EXPIRED", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const first = await sendInvite(principal.headers);
    await prisma.invite.update({
      where: { id: first.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await sendInvite(principal.headers);
    expect((await inviteRow(first.invite.id)).status).toBe("EXPIRED");
  });

  it("201 returns the link once and stores only the token's hash", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id, { name: "Class 10 A" });

    const res = await request(app).post(INVITES).set(principal.headers).send({
      inviteeEmail: "New.Student@Buddy.test",
      roleOnJoin: "TEACHER",
      classroomId: classroom.id,
    });
    expect(res.status).toBe(201);

    const { invite, inviteLink } = res.body.data;
    expect(inviteLink).toMatch(
      /^https:\/\/app\.buddy\.test\/invite\?token=[A-Za-z0-9_-]{43}$/
    );
    expect(invite).toMatchObject({
      inviteeEmail: INVITEE_EMAIL,
      roleOnJoin: "TEACHER",
      status: "PENDING",
      classroom: { id: classroom.id, name: "Class 10 A" },
    });
    expect(JSON.stringify(invite)).not.toMatch(/tokenHash|sentBy/);

    const token = tokenFrom(inviteLink);
    const row = await inviteRow(invite.id);
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toContain(token);
    expect(row.sentByUserId).toBe(principal.user.id);
    expect(row.organizationId).toBe(school.id);
    const sevenDays = 7 * 86_400_000;
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      sevenDays - 60_000
    );
  });
});

describe("GET /user/invites", () => {
  it("400 for a page size above 100", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const res = await request(app)
      .get(`${INVITES}?limit=101`)
      .set(principal.headers);
    expect(res.status).toBe(400);
  });

  it("200 lists only this organization's invites, with expired ones shown as EXPIRED", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    await sendInvite(other.principal.headers);
    const stale = await sendInvite(principal.headers, {
      inviteeEmail: "stale@buddy.test",
    });
    await prisma.invite.update({
      where: { id: stale.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await sendInvite(principal.headers);

    const all = await request(app).get(INVITES).set(principal.headers);
    expect(all.status).toBe(200);
    expect(all.body.data.meta.total).toBe(2);

    const pending = await request(app)
      .get(`${INVITES}?status=PENDING`)
      .set(principal.headers);
    expect(
      pending.body.data.items.map(
        (i: { inviteeEmail: string }) => i.inviteeEmail
      )
    ).toEqual([INVITEE_EMAIL]);

    const expired = await request(app)
      .get(`${INVITES}?status=EXPIRED`)
      .set(principal.headers);
    expect(expired.body.data.items).toHaveLength(1);
    expect(expired.body.data.items[0]).toMatchObject({
      inviteeEmail: "stale@buddy.test",
      status: "EXPIRED",
    });
  });
});

describe("DELETE /user/invites/:id", () => {
  it("404 for another organization's invite, which stays pending", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const { invite } = await sendInvite(other.principal.headers);
    const res = await request(app)
      .delete(`${INVITES}/${invite.id}`)
      .set(principal.headers);
    expect(res.status).toBe(404);
    expect((await inviteRow(invite.id)).status).toBe("PENDING");
  });

  it("200 revokes; the link then stops working and a second revoke is 409", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const { invite, token } = await sendInvite(principal.headers);

    const res = await request(app)
      .delete(`${INVITES}/${invite.id}`)
      .set(principal.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REVOKED");

    const again = await request(app)
      .delete(`${INVITES}/${invite.id}`)
      .set(principal.headers);
    expect(again.status).toBe(409);

    const invitee = await signInUser(INVITEE_EMAIL);
    const accepted = await accept(invitee.auth, token);
    expect(accepted.status).toBe(409);
    expect(accepted.body.message).toMatch(/revoked/);
  });
});

// ===========================================================================
// The invited person
// ===========================================================================

describe("GET /user/invites/received", () => {
  it("400 for a page size above 100", async () => {
    const invitee = await signInUser(INVITEE_EMAIL);
    const res = await request(app)
      .get(`${RECEIVED}?limit=101`)
      .set(invitee.auth);
    expect(res.status).toBe(400);
  });

  it("200 lists only usable invites to the caller's own email", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const closing = await createSchoolWithMembers(signInUser, "Closing Soon");
    const revoked = await createSchoolWithMembers(signInUser, "Revoked One");
    await sendInvite(principal.headers);
    await sendInvite(principal.headers, { inviteeEmail: "someone@buddy.test" });
    await sendInvite(closing.principal.headers);
    await prisma.organization.update({
      where: { id: closing.school.id },
      data: { isActive: false },
    });
    const { invite } = await sendInvite(revoked.principal.headers);
    await prisma.invite.update({
      where: { id: invite.id },
      data: { status: "REVOKED" },
    });

    const invitee = await signInUser(INVITEE_EMAIL);
    const res = await request(app).get(RECEIVED).set(invitee.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(1);
    expect(res.body.data.items[0]).toMatchObject({
      organization: { name: "Green Valley" },
      roleOnJoin: "STUDENT",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|inviteeEmail/);
  });
});

describe("POST /user/invites/accept", () => {
  it("400 for a malformed token or unknown fields", async () => {
    const invitee = await signInUser(INVITEE_EMAIL);
    for (const body of [
      { token: "short" },
      { token: "a".repeat(43), role: "ORGANIZATION_ADMIN" },
    ]) {
      const res = await request(app).post(ACCEPT).set(invitee.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("404 for an unknown token", async () => {
    const invitee = await signInUser(INVITEE_EMAIL);
    const res = await accept(invitee.auth, "a".repeat(43));
    expect(res.status).toBe(404);
  });

  it("403 when signed in with another email; the invite stays pending", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const { invite, token } = await sendInvite(principal.headers);
    const someoneElse = await signInUser("forwarded-to@buddy.test");

    const res = await accept(someoneElse.auth, token);
    expect(res.status).toBe(403);
    expect((await inviteRow(invite.id)).status).toBe("PENDING");
    expect(
      await prisma.membership.count({ where: { userId: someoneElse.user.id } })
    ).toBe(0);
  });

  it("200 joins with the invited role, consent and classroom, and uses the invite up", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    const { invite, token } = await sendInvite(principal.headers, {
      roleOnJoin: "TEACHER",
      classroomId: classroom.id,
    });
    const invitee = await signInUser(INVITEE_EMAIL);

    const res = await accept(invitee.auth, token, {
      sharePastDataWithOrganization: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      organizationId: school.id,
      role: "TEACHER",
    });

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: res.body.data.membershipId },
    });
    expect(membership).toMatchObject({
      userId: invitee.user.id,
      role: "TEACHER",
      status: "ACTIVE",
      joinMethod: "ACCEPTED_INVITE",
      sharePastDataWithOrganization: true,
    });
    expect(await inviteRow(invite.id)).toMatchObject({
      status: "ACCEPTED",
      acceptedByUserId: invitee.user.id,
    });
    expect(
      await prisma.classroomMember.count({
        where: { classroomId: classroom.id, membershipId: membership.id },
      })
    ).toBe(1);
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: school.id },
    });
    expect(organization.activeMemberCount).toBe(4);

    const current = await request(app)
      .get("/api/v1/user/organizations/current")
      .set(invitee.auth)
      .set({ "X-Organization-Id": school.id });
    expect(current.body.data.membership.role).toBe("TEACHER");

    const reused = await accept(invitee.auth, token);
    expect(reused.status).toBe(409);
    expect(reused.body.message).toMatch(/already been used/);
  });

  it("409 for an expired invite, which is marked EXPIRED", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const { invite, token } = await sendInvite(principal.headers);
    await prisma.invite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const invitee = await signInUser(INVITEE_EMAIL);

    const res = await accept(invitee.auth, token);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/expired/);
    expect((await inviteRow(invite.id)).status).toBe("EXPIRED");
  });

  it("409 when the person is already in another organization; the invite stays usable", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const { invite, token } = await sendInvite(principal.headers);
    const invitee = await signInUser(INVITEE_EMAIL);
    const otherSchool = await createOrganization();
    const otherMembership = await addMembership(
      otherSchool.id,
      invitee.user.id
    );

    const refused = await accept(invitee.auth, token);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/already in an organization/);
    expect((await inviteRow(invite.id)).status).toBe("PENDING");

    // After leaving the other organization, the same link works.
    await request(app)
      .post("/api/v1/user/organizations/current/leave")
      .set(invitee.auth)
      .set({ "X-Organization-Id": otherSchool.id });
    expect(
      (
        await prisma.membership.findUniqueOrThrow({
          where: { id: otherMembership.id },
        })
      ).status
    ).toBe("LEFT");
    expect((await accept(invitee.auth, token)).status).toBe(200);
  });

  it("409 when the organization is full; nothing is counted", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    await prisma.organization.update({
      where: { id: school.id },
      data: { maxMembers: 3 },
    });
    const { invite, token } = await sendInvite(principal.headers);
    const invitee = await signInUser(INVITEE_EMAIL);

    const res = await accept(invitee.auth, token);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/no free seats/);
    expect((await inviteRow(invite.id)).status).toBe("PENDING");
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: invitee.user.id },
    });
    expect(user.activeMembershipCount).toBe(0);
  });

  it("200 still joins when the classroom was archived after the invite was sent", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    const { token } = await sendInvite(principal.headers, {
      classroomId: classroom.id,
    });
    await prisma.classroom.update({
      where: { id: classroom.id },
      data: { isArchived: true },
    });
    const invitee = await signInUser(INVITEE_EMAIL);

    expect((await accept(invitee.auth, token)).status).toBe(200);
    expect(await prisma.classroomMember.count()).toBe(0);
  });

  it("parallel accepts of one link make exactly one membership", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const { token } = await sendInvite(principal.headers);
    const invitee = await signInUser(INVITEE_EMAIL);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => accept(invitee.auth, token))
    );
    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(
      await prisma.membership.count({ where: { userId: invitee.user.id } })
    ).toBe(1);
  });
});

describe("POST /user/invites/received/:id/accept", () => {
  it("404 for an invite sent to another email, even with its ID", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const { invite } = await sendInvite(principal.headers);
    const someoneElse = await signInUser("someone@buddy.test");
    const res = await request(app)
      .post(`${RECEIVED}/${invite.id}/accept`)
      .set(someoneElse.auth)
      .send({});
    expect(res.status).toBe(404);
    expect((await inviteRow(invite.id)).status).toBe("PENDING");
  });

  it("200 accepts from the list without the link; consent defaults to false", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const { invite } = await sendInvite(principal.headers);
    const invitee = await signInUser(INVITEE_EMAIL);

    const res = await request(app)
      .post(`${RECEIVED}/${invite.id}/accept`)
      .set(invitee.auth)
      .send({});
    expect(res.status).toBe(200);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: res.body.data.membershipId },
    });
    expect(membership.sharePastDataWithOrganization).toBe(false);
  });
});

// ===========================================================================
// Admin panel
// ===========================================================================

describe("POST /admin/organizations/:organizationId/invites", () => {
  it("400 for a malformed organization ID or bad body", async () => {
    const { auth } = await superAdmin();
    expect(
      (
        await request(app)
          .post(adminInvites("nope"))
          .set(auth)
          .send({ inviteeEmail: INVITEE_EMAIL })
      ).status
    ).toBe(400);
    const school = await createOrganization();
    expect(
      (
        await request(app)
          .post(adminInvites(school.id))
          .set(auth)
          .send({ inviteeEmail: "nope" })
      ).status
    ).toBe(400);
  });

  it("404 for a missing organization; 409 for a deactivated one", async () => {
    const { auth } = await superAdmin();
    const missing = await request(app)
      .post(adminInvites(MISSING_ID))
      .set(auth)
      .send({ inviteeEmail: INVITEE_EMAIL });
    expect(missing.status).toBe(404);

    const closed = await createOrganization({ isActive: false });
    const res = await request(app)
      .post(adminInvites(closed.id))
      .set(auth)
      .send({ inviteeEmail: INVITEE_EMAIL });
    expect(res.status).toBe(409);
  });

  it("201 invites the first organization admin, who joins before ever signing in to the organization", async () => {
    const { auth, admin } = await adminWith(["ORGANIZATION"]);
    const school = await createOrganization();

    const res = await request(app)
      .post(adminInvites(school.id))
      .set(auth)
      .send({
        inviteeEmail: "principal@buddy.test",
        roleOnJoin: "ORGANIZATION_ADMIN",
      });
    expect(res.status).toBe(201);
    const row = await inviteRow(res.body.data.invite.id);
    expect(row).toMatchObject({ sentByAdminId: admin.id, sentByUserId: null });

    const principal = await signInUser("principal@buddy.test");
    const accepted = await accept(
      principal.auth,
      tokenFrom(res.body.data.inviteLink)
    );
    expect(accepted.status).toBe(200);
    const joinCode = await request(app)
      .get("/api/v1/user/organizations/current/join-code")
      .set(principal.auth)
      .set({ "X-Organization-Id": school.id });
    expect(joinCode.status).toBe(200);
  });
});

describe("GET /admin/organizations/:organizationId/invites", () => {
  it("404 for a missing organization", async () => {
    const { auth } = await superAdmin();
    const res = await request(app).get(adminInvites(MISSING_ID)).set(auth);
    expect(res.status).toBe(404);
  });

  it("200 lists the organization's invites", async () => {
    const { auth } = await superAdmin();
    const { school, principal } = await createSchoolWithMembers(signInUser);
    await sendInvite(principal.headers);
    const res = await request(app).get(adminInvites(school.id)).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(1);
  });
});

describe("DELETE /admin/organizations/:organizationId/invites/:inviteId", () => {
  it("404 for an invite of another organization", async () => {
    const { auth } = await superAdmin();
    const { principal } = await createSchoolWithMembers(signInUser);
    const otherSchool = await createOrganization();
    const { invite } = await sendInvite(principal.headers);
    const res = await request(app)
      .delete(`${adminInvites(otherSchool.id)}/${invite.id}`)
      .set(auth);
    expect(res.status).toBe(404);
    expect((await inviteRow(invite.id)).status).toBe("PENDING");
  });

  it("200 revokes the invite", async () => {
    const { auth } = await superAdmin();
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const { invite } = await sendInvite(principal.headers);
    const res = await request(app)
      .delete(`${adminInvites(school.id)}/${invite.id}`)
      .set(auth);
    expect(res.status).toBe(200);
    expect((await inviteRow(invite.id)).status).toBe("REVOKED");
  });
});

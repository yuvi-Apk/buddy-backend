// Join requests (Way 2): a user sends an organization's join code (/user/join-requests);
// an organization admin of that organization approves or rejects it.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signInUser, superAdmin } from "../helpers/auth.js";
import {
  addMembership,
  createClassroom,
  createOrganization,
  createSchoolWithMembers,
} from "../helpers/fixtures.js";
import { MISSING_ID, type Route } from "../helpers/guards.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const JOIN_REQUESTS = "/api/v1/user/join-requests";
const MINE = `${JOIN_REQUESTS}/mine`;

beforeEach(resetState);
afterAll(closeTestApp);

const sendRequest = (
  auth: Record<string, string>,
  joinCode: string,
  body: Record<string, unknown> = {}
) =>
  request(app)
    .post(JOIN_REQUESTS)
    .set(auth)
    .send({ joinCode, ...body });

const joinRequestRow = (joinRequestId: string) =>
  prisma.joinRequest.findUniqueOrThrow({ where: { id: joinRequestId } });

// A school with an organization admin, and an applicant who has sent its join code.
async function pendingRequest(body: Record<string, unknown> = {}) {
  const members = await createSchoolWithMembers(signInUser);
  const applicant = await signInUser("applicant@buddy.test");
  const res = await sendRequest(applicant.auth, members.school.joinCode, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...members, applicant, joinRequestId: res.body.data.id as string };
}

// ===========================================================================
// Guards
// ===========================================================================

describe("guards on /user/join-requests", () => {
  const routes: Route[] = [
    ["post", JOIN_REQUESTS],
    ["get", MINE],
    ["post", `${MINE}/${MISSING_ID}/cancel`],
    ["get", JOIN_REQUESTS],
    ["post", `${JOIN_REQUESTS}/${MISSING_ID}/approve`],
    ["post", `${JOIN_REQUESTS}/${MISSING_ID}/reject`],
  ];
  const organizationAdminRoutes = routes.slice(3);

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

  it("organization-admin routes: 400 without X-Organization-Id, 403 for teachers and students", async () => {
    const { teacher, student } = await createSchoolWithMembers(signInUser);
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
});

// ===========================================================================
// The person asking
// ===========================================================================

describe("POST /user/join-requests", () => {
  it("400 for a malformed code, the ORGANIZATION_ADMIN role, a long note and unknown fields", async () => {
    const applicant = await signInUser("applicant@buddy.test");
    const attempts = [
      { joinCode: "no spaces!" },
      { joinCode: "GV12345", requestedRole: "ORGANIZATION_ADMIN" },
      { joinCode: "GV12345", requesterNote: "x".repeat(501) },
      { joinCode: "GV12345", organizationId: MISSING_ID },
    ];
    for (const body of attempts) {
      const res = await request(app)
        .post(JOIN_REQUESTS)
        .set(applicant.auth)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("404 with the same message for an unknown code, a deactivated organization and a switched-off code", async () => {
    const applicant = await signInUser("applicant@buddy.test");
    const closed = await createOrganization({ isActive: false });
    const codeOff = await createOrganization();
    await prisma.organization.update({
      where: { id: codeOff.id },
      data: { isJoinCodeEnabled: false },
    });

    const messages = new Set<string>();
    for (const joinCode of ["NOSUCHCODE", closed.joinCode, codeOff.joinCode]) {
      const res = await sendRequest(applicant.auth, joinCode);
      expect(res.status, joinCode).toBe(404);
      messages.add(res.body.message as string);
    }
    expect(messages.size).toBe(1);
    expect(await prisma.joinRequest.count()).toBe(0);
  });

  it("409 for a member of the organization, someone in another organization, and a second pending request", async () => {
    const { school, student } = await createSchoolWithMembers(signInUser);
    const member = await sendRequest(student.auth, school.joinCode);
    expect(member.status).toBe(409);

    const elsewhere = await signInUser("elsewhere@buddy.test");
    await addMembership((await createOrganization()).id, elsewhere.user.id);
    const inOther = await sendRequest(elsewhere.auth, school.joinCode);
    expect(inOther.status).toBe(409);
    expect(inOther.body.message).toMatch(/already in an organization/);

    const applicant = await signInUser("applicant@buddy.test");
    await sendRequest(applicant.auth, school.joinCode);
    const duplicate = await sendRequest(applicant.auth, school.joinCode);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/pending request/);
  });

  it("201 creates the request from a code typed in lowercase", async () => {
    const school = await createOrganization({ name: "Green Valley" });
    const applicant = await signInUser("applicant@buddy.test");

    const res = await sendRequest(
      applicant.auth,
      school.joinCode.toLowerCase(),
      {
        requestedRole: "TEACHER",
        requesterNote: "  I teach maths  ",
        sharePastDataWithOrganization: true,
      }
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      organization: { id: school.id, name: "Green Valley" },
      requestedRole: "TEACHER",
      status: "PENDING",
      requesterNote: "I teach maths",
      reviewNote: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/reviewedByUserId|joinCode/);
    const row = await joinRequestRow(res.body.data.id);
    expect(row).toMatchObject({
      userId: applicant.user.id,
      sharePastDataWithOrganization: true,
    });
  });

  it("429 after too many join code attempts", async () => {
    const applicant = await signInUser("applicant@buddy.test");
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      statuses.push(
        (await sendRequest(applicant.auth, `GUESS${attempt}`)).status
      );
    }
    expect(statuses.slice(0, 10).every((status) => status === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("GET /user/join-requests/mine", () => {
  it("400 for a page size above 100", async () => {
    const applicant = await signInUser("applicant@buddy.test");
    const res = await request(app).get(`${MINE}?limit=101`).set(applicant.auth);
    expect(res.status).toBe(400);
  });

  it("200 lists only the caller's own requests, filtered by status", async () => {
    const { applicant, joinRequestId } = await pendingRequest();
    const second = await createOrganization();
    const cancelled = await sendRequest(applicant.auth, second.joinCode);
    await request(app)
      .post(`${MINE}/${cancelled.body.data.id}/cancel`)
      .set(applicant.auth);
    const someoneElse = await signInUser("someone@buddy.test");
    await sendRequest(someoneElse.auth, second.joinCode);

    const all = await request(app).get(MINE).set(applicant.auth);
    expect(all.status).toBe(200);
    expect(all.body.data.meta.total).toBe(2);

    const pending = await request(app)
      .get(`${MINE}?status=PENDING`)
      .set(applicant.auth);
    expect(pending.body.data.items.map((r: { id: string }) => r.id)).toEqual([
      joinRequestId,
    ]);
  });
});

describe("POST /user/join-requests/mine/:id/cancel", () => {
  it("404 for someone else's request, which stays pending", async () => {
    const { joinRequestId } = await pendingRequest();
    const someoneElse = await signInUser("someone@buddy.test");
    const res = await request(app)
      .post(`${MINE}/${joinRequestId}/cancel`)
      .set(someoneElse.auth);
    expect(res.status).toBe(404);
    expect((await joinRequestRow(joinRequestId)).status).toBe("PENDING");
  });

  it("200 cancels; cancelling again is 409, and a new request is allowed", async () => {
    const { applicant, joinRequestId, school } = await pendingRequest();
    const res = await request(app)
      .post(`${MINE}/${joinRequestId}/cancel`)
      .set(applicant.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");

    const again = await request(app)
      .post(`${MINE}/${joinRequestId}/cancel`)
      .set(applicant.auth);
    expect(again.status).toBe(409);

    expect((await sendRequest(applicant.auth, school.joinCode)).status).toBe(
      201
    );
  });
});

// ===========================================================================
// Organization admins
// ===========================================================================

describe("GET /user/join-requests", () => {
  it("400 for a page size above 100", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const res = await request(app)
      .get(`${JOIN_REQUESTS}?limit=101`)
      .set(principal.headers);
    expect(res.status).toBe(400);
  });

  it("200 lists only this organization's requests, oldest first, without internal fields", async () => {
    const { principal, school, joinRequestId } = await pendingRequest();
    const later = await signInUser("later@buddy.test");
    await sendRequest(later.auth, school.joinCode);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    await sendRequest(later.auth, other.school.joinCode);

    const res = await request(app)
      .get(`${JOIN_REQUESTS}?status=PENDING`)
      .set(principal.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(2);
    expect(res.body.data.items[0]).toMatchObject({
      id: joinRequestId,
      user: { email: "applicant@buddy.test" },
    });
    expect(res.body.data.items[0].user).not.toHaveProperty("googleAccountId");
  });
});

describe("POST /user/join-requests/:id/approve", () => {
  const approve = (
    headers: Record<string, string>,
    joinRequestId: string,
    body: Record<string, unknown> = {}
  ) =>
    request(app)
      .post(`${JOIN_REQUESTS}/${joinRequestId}/approve`)
      .set(headers)
      .send(body);

  it("400 for the ORGANIZATION_ADMIN role, a malformed classroom ID and unknown fields", async () => {
    const { principal, joinRequestId } = await pendingRequest();
    for (const body of [
      { role: "ORGANIZATION_ADMIN" },
      { classroomId: "nope" },
      { status: "APPROVED" },
    ]) {
      const res = await approve(principal.headers, joinRequestId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("404 for another organization's request, or a classroom of another organization", async () => {
    const { joinRequestId, principal } = await pendingRequest();
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const foreign = await approve(other.principal.headers, joinRequestId);
    expect(foreign.status).toBe(404);

    const otherClassroom = await createClassroom(other.school.id);
    const wrongClassroom = await approve(principal.headers, joinRequestId, {
      classroomId: otherClassroom.id,
    });
    expect(wrongClassroom.status).toBe(404);
    expect((await joinRequestRow(joinRequestId)).status).toBe("PENDING");
    expect(await prisma.membership.count({ where: { status: "ACTIVE" } })).toBe(
      6
    );
  });

  it("200 approves: the person joins with the requested role, consent and a classroom", async () => {
    const { school, principal, applicant, joinRequestId } =
      await pendingRequest({ sharePastDataWithOrganization: true });
    const classroom = await createClassroom(school.id);

    const res = await approve(principal.headers, joinRequestId, {
      classroomId: classroom.id,
      reviewNote: "Welcome",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.joinRequest).toMatchObject({
      status: "APPROVED",
      reviewNote: "Welcome",
    });

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: res.body.data.membershipId },
    });
    expect(membership).toMatchObject({
      userId: applicant.user.id,
      role: "STUDENT",
      joinMethod: "APPROVED_JOIN_REQUEST",
      sharePastDataWithOrganization: true,
    });
    expect(await joinRequestRow(joinRequestId)).toMatchObject({
      reviewedByUserId: principal.user.id,
    });
    expect(
      await prisma.classroomMember.count({
        where: { classroomId: classroom.id, membershipId: membership.id },
      })
    ).toBe(1);

    const mine = await request(app).get(MINE).set(applicant.auth);
    expect(mine.body.data.items[0]).toMatchObject({
      status: "APPROVED",
      reviewNote: "Welcome",
    });
  });

  it("200 with a role override", async () => {
    const { principal, joinRequestId } = await pendingRequest();
    const res = await approve(principal.headers, joinRequestId, {
      role: "TEACHER",
    });
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: res.body.data.membershipId },
    });
    expect(membership.role).toBe("TEACHER");
  });

  it("409 for a request that was already approved, rejected or cancelled", async () => {
    const { principal, joinRequestId } = await pendingRequest();
    await approve(principal.headers, joinRequestId);
    const again = await approve(principal.headers, joinRequestId);
    expect(again.status).toBe(409);
  });

  it("409 when the organization is full; the request goes back to PENDING", async () => {
    const { school, principal, applicant, joinRequestId } =
      await pendingRequest();
    await prisma.organization.update({
      where: { id: school.id },
      data: { maxMembers: 3 },
    });

    const res = await approve(principal.headers, joinRequestId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/no free seats/);
    expect(await joinRequestRow(joinRequestId)).toMatchObject({
      status: "PENDING",
      reviewedByUserId: null,
      reviewedAt: null,
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: applicant.user.id },
    });
    expect(user.activeMembershipCount).toBe(0);
  });

  it("409 when the person joined another organization meanwhile; the request stays PENDING", async () => {
    const { principal, applicant, joinRequestId } = await pendingRequest();
    await addMembership((await createOrganization()).id, applicant.user.id);

    const res = await approve(principal.headers, joinRequestId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/another organization/);
    expect((await joinRequestRow(joinRequestId)).status).toBe("PENDING");
  });

  it("approve and reject at the same time: exactly one wins", async () => {
    const { principal, joinRequestId } = await pendingRequest();
    const [approved, rejected] = await Promise.all([
      approve(principal.headers, joinRequestId),
      request(app)
        .post(`${JOIN_REQUESTS}/${joinRequestId}/reject`)
        .set(principal.headers)
        .send({}),
    ]);
    expect([approved.status, rejected.status].sort()).toEqual([200, 409]);
    const finalStatus = (await joinRequestRow(joinRequestId)).status;
    const memberships = await prisma.membership.count({
      where: { joinMethod: "APPROVED_JOIN_REQUEST" },
    });
    expect(memberships).toBe(finalStatus === "APPROVED" ? 1 : 0);
  });
});

describe("POST /user/join-requests/:id/reject", () => {
  it("404 for another organization's request", async () => {
    const { joinRequestId } = await pendingRequest();
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const res = await request(app)
      .post(`${JOIN_REQUESTS}/${joinRequestId}/reject`)
      .set(other.principal.headers)
      .send({});
    expect(res.status).toBe(404);
    expect((await joinRequestRow(joinRequestId)).status).toBe("PENDING");
  });

  it("409 for a request the person cancelled", async () => {
    const { principal, applicant, joinRequestId } = await pendingRequest();
    await request(app)
      .post(`${MINE}/${joinRequestId}/cancel`)
      .set(applicant.auth);
    const res = await request(app)
      .post(`${JOIN_REQUESTS}/${joinRequestId}/reject`)
      .set(principal.headers)
      .send({});
    expect(res.status).toBe(409);
  });

  it("200 rejects with a note the person can read; nobody joins", async () => {
    const { principal, applicant, joinRequestId } = await pendingRequest();
    const res = await request(app)
      .post(`${JOIN_REQUESTS}/${joinRequestId}/reject`)
      .set(principal.headers)
      .send({ reviewNote: "Classes are full this term" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REJECTED");

    const mine = await request(app).get(MINE).set(applicant.auth);
    expect(mine.body.data.items[0]).toMatchObject({
      status: "REJECTED",
      reviewNote: "Classes are full this term",
    });
    expect(
      await prisma.membership.count({ where: { userId: applicant.user.id } })
    ).toBe(0);
  });
});

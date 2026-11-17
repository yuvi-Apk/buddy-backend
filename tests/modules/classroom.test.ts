// /user/classrooms: classrooms inside the X-Organization-Id organization. Organization admins
// manage them and see all; teachers and students see only the classrooms they are in.
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signInUser, superAdmin } from "../helpers/auth.js";
import {
  addMembership,
  addToClassroom,
  createClassroom,
  createSchoolWithMembers,
  createUser,
} from "../helpers/fixtures.js";
import { MISSING_ID, type Route } from "../helpers/guards.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const CLASSROOMS = "/api/v1/user/classrooms";

beforeEach(resetState);
afterAll(closeTestApp);

describe("guards on /user/classrooms", () => {
  const routes: Route[] = [
    ["get", CLASSROOMS],
    ["post", CLASSROOMS],
    ["get", `${CLASSROOMS}/${MISSING_ID}`],
    ["patch", `${CLASSROOMS}/${MISSING_ID}`],
    ["get", `${CLASSROOMS}/${MISSING_ID}/members`],
    ["post", `${CLASSROOMS}/${MISSING_ID}/members`],
    ["delete", `${CLASSROOMS}/${MISSING_ID}/members/${MISSING_ID}`],
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

  it("400 without the X-Organization-Id header", async () => {
    const { student } = await createSchoolWithMembers(signInUser);
    for (const [method, path] of routes) {
      const res = await request(app)[method](path).set(student.auth);
      expect(res.status, `${method} ${path}`).toBe(400);
    }
  });

  it("403 for a student on management routes, and for a student listing members", async () => {
    const { student } = await createSchoolWithMembers(signInUser);
    const managementRoutes = routes.filter(
      ([method, path]) => method !== "get" || path.endsWith("/members")
    );
    for (const [method, path] of managementRoutes) {
      const res = await request(app)[method](path).set(student.headers);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("403 for a teacher on routes that change classrooms", async () => {
    const { teacher } = await createSchoolWithMembers(signInUser);
    for (const [method, path] of routes.filter(([m]) => m !== "get")) {
      const res = await request(app)[method](path).set(teacher.headers);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("GET /user/classrooms", () => {
  it("400 for a page size above 100", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const res = await request(app)
      .get(`${CLASSROOMS}?limit=101`)
      .set(principal.headers);
    expect(res.status).toBe(400);
  });

  it("200 the organization admin sees every unarchived classroom of their organization, with pagination", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    await createClassroom(school.id, { name: "Class 10 A" });
    await createClassroom(school.id, { name: "Class 10 B" });
    await createClassroom(school.id, { name: "Class 9 A", isArchived: true });
    await createClassroom(other.school.id, { name: "Class 10 C" });

    const res = await request(app)
      .get(`${CLASSROOMS}?limit=1`)
      .set(principal.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.meta).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });

    const archived = await request(app)
      .get(`${CLASSROOMS}?isArchived=true`)
      .set(principal.headers);
    expect(
      archived.body.data.items.map((c: { name: string }) => c.name)
    ).toEqual(["Class 9 A"]);
  });

  it("200 teachers and students see only the classrooms they are in", async () => {
    const { school, teacher, student } =
      await createSchoolWithMembers(signInUser);
    const tenA = await createClassroom(school.id, { name: "Class 10 A" });
    const tenB = await createClassroom(school.id, { name: "Class 10 B" });
    await addToClassroom(tenA, teacher.membership.id);
    await addToClassroom(tenB, teacher.membership.id);
    await addToClassroom(tenB, student.membership.id);

    const teacherView = await request(app).get(CLASSROOMS).set(teacher.headers);
    expect(
      teacherView.body.data.items.map((c: { name: string }) => c.name)
    ).toEqual(["Class 10 A", "Class 10 B"]);

    const studentView = await request(app).get(CLASSROOMS).set(student.headers);
    expect(studentView.body.data.items).toHaveLength(1);
    expect(studentView.body.data.items[0]).toMatchObject({
      name: "Class 10 B",
      memberCount: 2,
    });
  });
});

describe("POST /user/classrooms", () => {
  it("400 for a missing name, a bad academic year and unknown fields", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const attempts = [
      {},
      { name: "Class 10 A", academicYear: "next year" },
      { name: "Class 10 A", organizationId: MISSING_ID },
    ];
    for (const body of attempts) {
      const res = await request(app)
        .post(CLASSROOMS)
        .set(principal.headers)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("409 for a duplicate name in the same organization", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    await createClassroom(school.id, { name: "Class 10 A" });
    const res = await request(app)
      .post(CLASSROOMS)
      .set(principal.headers)
      .send({ name: "Class 10 A" });
    expect(res.status).toBe(409);
  });

  it("201 creates the classroom in the caller's organization; another organization may reuse the name", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    await createClassroom(other.school.id, { name: "Class 10 A" });

    const res = await request(app)
      .post(CLASSROOMS)
      .set(principal.headers)
      .send({ name: "Class 10 A", academicYear: "2026-27" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "Class 10 A",
      academicYear: "2026-27",
      isArchived: false,
      memberCount: 0,
    });
    expect(res.body.data).not.toHaveProperty("organizationId");
    const row = await prisma.classroom.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.organizationId).toBe(school.id);
  });
});

describe("GET /user/classrooms/:id", () => {
  it("400 for a malformed ID", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const res = await request(app)
      .get(`${CLASSROOMS}/not-a-uuid`)
      .set(principal.headers);
    expect(res.status).toBe(400);
  });

  it("404 for another organization's classroom, even for an organization admin", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const otherClassroom = await createClassroom(other.school.id);
    const res = await request(app)
      .get(`${CLASSROOMS}/${otherClassroom.id}`)
      .set(principal.headers);
    expect(res.status).toBe(404);
  });

  it("404 for a student who is not in the classroom; 200 once they are", async () => {
    const { school, student } = await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    const path = `${CLASSROOMS}/${classroom.id}`;

    expect((await request(app).get(path).set(student.headers)).status).toBe(
      404
    );
    await addToClassroom(classroom, student.membership.id);
    const res = await request(app).get(path).set(student.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.memberCount).toBe(1);
  });
});

describe("PATCH /user/classrooms/:id", () => {
  it("400 for an empty body or unknown fields", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    for (const body of [{}, { organizationId: MISSING_ID }]) {
      const res = await request(app)
        .patch(`${CLASSROOMS}/${classroom.id}`)
        .set(principal.headers)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("404 for another organization's classroom, which stays unchanged", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const otherClassroom = await createClassroom(other.school.id);
    const res = await request(app)
      .patch(`${CLASSROOMS}/${otherClassroom.id}`)
      .set(principal.headers)
      .send({ isArchived: true });
    expect(res.status).toBe(404);
    const row = await prisma.classroom.findUniqueOrThrow({
      where: { id: otherClassroom.id },
    });
    expect(row.isArchived).toBe(false);
  });

  it("200 renames and archives", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    const res = await request(app)
      .patch(`${CLASSROOMS}/${classroom.id}`)
      .set(principal.headers)
      .send({ name: "Class 11 A", academicYear: null, isArchived: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "Class 11 A",
      academicYear: null,
      isArchived: true,
    });
  });
});

describe("GET /user/classrooms/:id/members", () => {
  it("404 for a teacher who is not in the classroom", async () => {
    const { school, teacher } = await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    const res = await request(app)
      .get(`${CLASSROOMS}/${classroom.id}/members`)
      .set(teacher.headers);
    expect(res.status).toBe(404);
  });

  it("200 the classroom's teacher lists its members, filtered by role, without internal fields", async () => {
    const { school, teacher, student } =
      await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    await addToClassroom(classroom, teacher.membership.id);
    await addToClassroom(classroom, student.membership.id);

    const all = await request(app)
      .get(`${CLASSROOMS}/${classroom.id}/members`)
      .set(teacher.headers);
    expect(all.status).toBe(200);
    expect(all.body.data.meta.total).toBe(2);

    const students = await request(app)
      .get(`${CLASSROOMS}/${classroom.id}/members?role=STUDENT`)
      .set(teacher.headers);
    expect(students.body.data.items).toEqual([
      {
        membershipId: student.membership.id,
        role: "STUDENT",
        addedAt: expect.any(String),
        user: expect.objectContaining({ id: student.user.id }),
      },
    ]);
    expect(students.body.data.items[0].user).not.toHaveProperty(
      "googleAccountId"
    );
  });
});

describe("POST /user/classrooms/:id/members", () => {
  const addMember = (
    headers: Record<string, string>,
    classroomId: string,
    membershipId: string
  ) =>
    request(app)
      .post(`${CLASSROOMS}/${classroomId}/members`)
      .set(headers)
      .send({ membershipId });

  it("400 for a malformed membership ID or unknown fields", async () => {
    const { school, principal, student } =
      await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    for (const body of [
      { membershipId: "nope" },
      { membershipId: student.membership.id, role: "TEACHER" },
    ]) {
      const res = await request(app)
        .post(`${CLASSROOMS}/${classroom.id}/members`)
        .set(principal.headers)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("404 for another organization's classroom or member, or a member who left or is suspended", async () => {
    const { school, principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const classroom = await createClassroom(school.id);
    const otherClassroom = await createClassroom(other.school.id);
    const formerStudent = await addMembership(
      school.id,
      (await createUser()).id,
      { status: "LEFT" }
    );
    const suspendedStudent = await addMembership(
      school.id,
      (await createUser()).id,
      { status: "SUSPENDED" }
    );

    expect(
      (
        await addMember(
          principal.headers,
          otherClassroom.id,
          principal.membership.id
        )
      ).status
    ).toBe(404);
    for (const membershipId of [
      other.student.membership.id,
      formerStudent.id,
      suspendedStudent.id,
    ]) {
      const res = await addMember(
        principal.headers,
        classroom.id,
        membershipId
      );
      expect(res.status, membershipId).toBe(404);
    }
    expect(await prisma.classroomMember.count()).toBe(0);
  });

  it("409 for an archived classroom or a member already in it", async () => {
    const { school, principal, student } =
      await createSchoolWithMembers(signInUser);
    const archived = await createClassroom(school.id, { isArchived: true });
    expect(
      (await addMember(principal.headers, archived.id, student.membership.id))
        .status
    ).toBe(409);

    const classroom = await createClassroom(school.id);
    await addToClassroom(classroom, student.membership.id);
    expect(
      (await addMember(principal.headers, classroom.id, student.membership.id))
        .status
    ).toBe(409);
  });

  it("201 adds the member to the classroom", async () => {
    const { school, principal, student } =
      await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    const res = await addMember(
      principal.headers,
      classroom.id,
      student.membership.id
    );
    expect(res.status).toBe(201);
    const visible = await request(app)
      .get(`${CLASSROOMS}/${classroom.id}`)
      .set(student.headers);
    expect(visible.status).toBe(200);
  });
});

describe("DELETE /user/classrooms/:id/members/:membershipId", () => {
  it("404 for a member who is not in the classroom", async () => {
    const { school, principal, student } =
      await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    const res = await request(app)
      .delete(`${CLASSROOMS}/${classroom.id}/members/${student.membership.id}`)
      .set(principal.headers);
    expect(res.status).toBe(404);
  });

  it("404 for another organization's classroom, whose members stay", async () => {
    const { principal } = await createSchoolWithMembers(signInUser);
    const other = await createSchoolWithMembers(signInUser, "Blue Hills");
    const otherClassroom = await createClassroom(other.school.id);
    await addToClassroom(otherClassroom, other.student.membership.id);
    const res = await request(app)
      .delete(
        `${CLASSROOMS}/${otherClassroom.id}/members/${other.student.membership.id}`
      )
      .set(principal.headers);
    expect(res.status).toBe(404);
    expect(await prisma.classroomMember.count()).toBe(1);
  });

  it("200 removes the member from the classroom only", async () => {
    const { school, principal, student } =
      await createSchoolWithMembers(signInUser);
    const classroom = await createClassroom(school.id);
    await addToClassroom(classroom, student.membership.id);
    const res = await request(app)
      .delete(`${CLASSROOMS}/${classroom.id}/members/${student.membership.id}`)
      .set(principal.headers);
    expect(res.status).toBe(200);
    expect(await prisma.classroomMember.count()).toBe(0);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: student.membership.id },
    });
    expect(membership.status).toBe("ACTIVE");
  });
});

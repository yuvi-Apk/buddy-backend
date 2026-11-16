// Rules the database itself enforces (hand-written in the google_sign_in_and_organizations
// migration). They hold even if service code has a bug.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAdmin, createUser } from "../helpers/fixtures.js";
import { closeTestApp, prisma, resetState } from "../helpers/testApp.js";

beforeEach(resetState);
afterAll(closeTestApp);

const createOrganization = (maxMembers: number | null = null) =>
  prisma.organization.create({
    data: {
      name: "Green Valley School",
      slug: `green-valley-${Date.now()}-${Math.random()}`,
      joinCode: `GV${Date.now()}${Math.floor(Math.random() * 1000)}`,
      maxMembers,
    },
  });

describe("users_membership_limit_ck", () => {
  it("refuses a second active membership without canJoinMultipleOrganizations", async () => {
    const user = await createUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { activeMembershipCount: 1 },
    });
    await expect(
      prisma.user.update({
        where: { id: user.id },
        data: { activeMembershipCount: { increment: 1 } },
      })
    ).rejects.toThrow();
  });

  it("allows several with the flag, and never a negative count", async () => {
    const user = await createUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { canJoinMultipleOrganizations: true, activeMembershipCount: 3 },
    });
    await expect(
      prisma.user.update({
        where: { id: user.id },
        data: { activeMembershipCount: -1 },
      })
    ).rejects.toThrow();
  });

  it("refuses to turn the flag off while the user is in several organizations", async () => {
    const user = await createUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { canJoinMultipleOrganizations: true, activeMembershipCount: 2 },
    });
    await expect(
      prisma.user.update({
        where: { id: user.id },
        data: { canJoinMultipleOrganizations: false },
      })
    ).rejects.toThrow();
  });
});

describe("organizations_max_members_ck", () => {
  it("refuses more active members than maxMembers", async () => {
    const organization = await createOrganization(1);
    await prisma.organization.update({
      where: { id: organization.id },
      data: { activeMemberCount: 1 },
    });
    await expect(
      prisma.organization.update({
        where: { id: organization.id },
        data: { activeMemberCount: { increment: 1 } },
      })
    ).rejects.toThrow();
  });
});

describe("invites", () => {
  const inviteData = (organizationId: string, overrides = {}) => ({
    organizationId,
    inviteeEmail: "new.student@buddy.test",
    tokenHash: `hash-${Math.random()}`,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  });

  it("invites_one_sender_ck: refuses an invite with no sender or two senders", async () => {
    const organization = await createOrganization();
    const sender = await createUser();
    await expect(
      prisma.invite.create({ data: inviteData(organization.id) })
    ).rejects.toThrow();

    const { admin } = await createAdmin();
    await expect(
      prisma.invite.create({
        data: inviteData(organization.id, {
          sentByUserId: sender.id,
          sentByAdminId: admin.id,
        }),
      })
    ).rejects.toThrow();
  });

  it("invites_one_pending_uq: one pending invite per email per organization", async () => {
    const organization = await createOrganization();
    const sender = await createUser();
    await prisma.invite.create({
      data: inviteData(organization.id, { sentByUserId: sender.id }),
    });
    await expect(
      prisma.invite.create({
        data: inviteData(organization.id, { sentByUserId: sender.id }),
      })
    ).rejects.toThrow();

    // Once the first is no longer pending, a new invite is fine.
    await prisma.invite.updateMany({ data: { status: "REVOKED" } });
    await prisma.invite.create({
      data: inviteData(organization.id, { sentByUserId: sender.id }),
    });
    expect(await prisma.invite.count()).toBe(2);
  });
});

describe("join_requests", () => {
  it("join_requests_role_ck: nobody can request ORGANIZATION_ADMIN", async () => {
    const organization = await createOrganization();
    const user = await createUser();
    await expect(
      prisma.joinRequest.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          requestedRole: "ORGANIZATION_ADMIN",
        },
      })
    ).rejects.toThrow();
  });

  it("join_requests_one_pending_uq: one pending request per user per organization", async () => {
    const organization = await createOrganization();
    const user = await createUser();
    const data = { userId: user.id, organizationId: organization.id };
    await prisma.joinRequest.create({ data });
    await expect(prisma.joinRequest.create({ data })).rejects.toThrow();

    await prisma.joinRequest.updateMany({ data: { status: "CANCELLED" } });
    await prisma.joinRequest.create({ data });
    expect(await prisma.joinRequest.count()).toBe(2);
  });
});

describe("classroom_members composite foreign keys", () => {
  it("refuses to put a member into a classroom of another organization", async () => {
    const school = await createOrganization();
    const otherSchool = await createOrganization();
    const user = await createUser();
    const membership = await prisma.membership.create({
      data: {
        organizationId: school.id,
        userId: user.id,
        role: "STUDENT",
        joinMethod: "ADDED_BY_ADMIN",
      },
    });
    const otherClassroom = await prisma.classroom.create({
      data: { organizationId: otherSchool.id, name: "Class 10 A" },
    });

    for (const organizationId of [school.id, otherSchool.id]) {
      await expect(
        prisma.classroomMember.create({
          data: {
            classroomId: otherClassroom.id,
            membershipId: membership.id,
            organizationId,
          },
        })
      ).rejects.toThrow();
    }
  });
});

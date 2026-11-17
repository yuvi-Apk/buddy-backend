import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "../../../utils/ApiError.js";
import { paginated, type Paginated } from "../../../utils/pagination.js";
import type { AuthenticatedUser } from "../../user-panel/user-auth/index.js";
import type { ClassroomService } from "../../user-panel/classroom/index.js";
import type {
  ActiveMembership,
  JoinRefusal,
  OrganizationService,
} from "../organization/index.js";
import type { InviteForAccept, InviteRepository } from "./invite.repository.js";
import type {
  AcceptedInviteDto,
  CreatedInviteDto,
  CreateInviteBody,
  InviteDto,
  ListInvitesQuery,
  ListReceivedInvitesQuery,
  ReceivedInviteDto,
} from "./invite.schema.js";

const INVITE_TTL_DAYS = 7;

const JOIN_REFUSAL_MESSAGES: Record<JoinRefusal, string> = {
  USER_NOT_FOUND: "Your account is disabled",
  USER_IN_ANOTHER_ORGANIZATION:
    "You are already in an organization. Leave it before joining another",
  ORGANIZATION_NOT_FOUND: "This organization is no longer active",
  ORGANIZATION_INACTIVE: "This organization is no longer active",
  ORGANIZATION_FULL: "This organization has no free seats",
  ALREADY_MEMBER: "You are already a member of this organization",
};

const hashInviteToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export class InviteService {
  constructor(
    private readonly invites: InviteRepository,
    private readonly organizations: OrganizationService,
    private readonly classrooms: ClassroomService,
    private readonly inviteLinkBaseUrl: string
  ) {}

  // ===========================================================================
  // Sending (organization admins in the app, admins in the panel)
  // ===========================================================================

  createAsOrganizationAdmin(
    caller: ActiveMembership,
    userId: string,
    input: CreateInviteBody
  ): Promise<CreatedInviteDto> {
    return this.create(caller.organizationId, input, { userId });
  }

  async createAsAdmin(
    organizationId: string,
    adminId: string,
    input: CreateInviteBody
  ): Promise<CreatedInviteDto> {
    const organization = await this.organizations.getById(organizationId);
    if (!organization.isActive) {
      throw ApiError.conflict("This organization is deactivated");
    }
    return this.create(organizationId, input, { adminId });
  }

  async list(
    organizationId: string,
    query: ListInvitesQuery
  ): Promise<Paginated<InviteDto>> {
    const { items, total } = await this.invites.list(organizationId, query);
    return paginated(items, total, query);
  }

  async listAsAdmin(
    organizationId: string,
    query: ListInvitesQuery
  ): Promise<Paginated<InviteDto>> {
    await this.organizations.getById(organizationId);
    return this.list(organizationId, query);
  }

  async revoke(organizationId: string, inviteId: string): Promise<InviteDto> {
    const result = await this.invites.revoke(organizationId, inviteId);
    if (result === "NOT_FOUND") throw ApiError.notFound("Invite not found");
    if (result === "NOT_PENDING") {
      throw ApiError.conflict("Only a pending invite can be revoked");
    }
    return result;
  }

  // ===========================================================================
  // Receiving (the invited person, signed in with the invited email)
  // ===========================================================================

  async listReceived(
    user: AuthenticatedUser,
    query: ListReceivedInvitesQuery
  ): Promise<Paginated<ReceivedInviteDto>> {
    const { items, total } = await this.invites.listReceived(user.email, query);
    return paginated(items, total, query);
  }

  // From the link. The token proves the link was received; the Google-verified email
  // must still match, so a forwarded link is useless to anyone else.
  async acceptByToken(
    user: AuthenticatedUser,
    token: string,
    sharePastDataWithOrganization: boolean
  ): Promise<AcceptedInviteDto> {
    const invite = await this.invites.findForAcceptByTokenHash(
      hashInviteToken(token)
    );
    if (!invite) throw ApiError.notFound("Invite not found");
    if (invite.inviteeEmail !== user.email) {
      throw ApiError.forbidden("This invite was sent to another email address");
    }
    return this.accept(invite, user.id, sharePastDataWithOrganization);
  }

  // From the "invites for me" list in the app.
  async acceptById(
    user: AuthenticatedUser,
    inviteId: string,
    sharePastDataWithOrganization: boolean
  ): Promise<AcceptedInviteDto> {
    const invite = await this.invites.findForAcceptById(inviteId, user.email);
    if (!invite) throw ApiError.notFound("Invite not found");
    return this.accept(invite, user.id, sharePastDataWithOrganization);
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async create(
    organizationId: string,
    input: CreateInviteBody,
    sentBy: { userId: string } | { adminId: string }
  ): Promise<CreatedInviteDto> {
    if (input.classroomId) {
      await this.classrooms.assertCanAddMembersTo(
        organizationId,
        input.classroomId
      );
    }

    const token = randomBytes(32).toString("base64url");
    // A second pending invite to the same email hits invites_one_pending_uq: 409 in errorHandler.
    const invite = await this.invites.create({
      organizationId,
      inviteeEmail: input.inviteeEmail,
      roleOnJoin: input.roleOnJoin,
      classroomId: input.classroomId,
      tokenHash: hashInviteToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      sentBy,
    });

    const inviteLink = new URL(this.inviteLinkBaseUrl);
    inviteLink.searchParams.set("token", token);
    return { invite, inviteLink: inviteLink.toString() };
  }

  // Claim the invite, then join (the join rule in OrganizationService). If joining is
  // refused, the claim is released so the invite can still be used later.
  private async accept(
    invite: InviteForAccept,
    userId: string,
    sharePastDataWithOrganization: boolean
  ): Promise<AcceptedInviteDto> {
    await this.assertUsable(invite);
    if (!(await this.invites.claim(invite.id, userId))) {
      throw ApiError.conflict("This invite is no longer valid");
    }

    let joined: Awaited<ReturnType<OrganizationService["addMember"]>>;
    try {
      joined = await this.organizations.addMember({
        organizationId: invite.organizationId,
        userId,
        role: invite.roleOnJoin,
        joinMethod: "ACCEPTED_INVITE",
        sharePastDataWithOrganization,
      });
    } catch (err) {
      await this.invites.releaseClaim(invite.id);
      throw err;
    }
    if ("refusedBecause" in joined) {
      await this.invites.releaseClaim(invite.id);
      throw ApiError.conflict(JOIN_REFUSAL_MESSAGES[joined.refusedBecause]);
    }

    if (invite.classroomId) {
      await this.classrooms.addMemberAfterJoining(
        invite.organizationId,
        invite.classroomId,
        joined.member.id
      );
    }
    return {
      organizationId: invite.organizationId,
      membershipId: joined.member.id,
      role: invite.roleOnJoin,
    };
  }

  private async assertUsable(invite: InviteForAccept): Promise<void> {
    if (invite.status === "ACCEPTED") {
      throw ApiError.conflict("This invite has already been used");
    }
    if (invite.status === "REVOKED") {
      throw ApiError.conflict("This invite was revoked");
    }
    if (invite.status === "EXPIRED" || invite.expiresAt <= new Date()) {
      await this.invites.markExpired(invite.id);
      throw ApiError.conflict("This invite has expired");
    }
  }
}

import { randomInt } from "node:crypto";
import { ApiError } from "../../utils/ApiError.js";
import { paginated, type Paginated } from "../../utils/pagination.js";
import type { UserAuthService } from "../user-auth/index.js";
import type {
  JoinOrganizationInput,
  JoinRefusal,
  OrganizationRepository,
} from "./organization.repository.js";
import type {
  ActiveMembership,
  CreateOrganizationBody,
  JoinCodeDto,
  ListMembersQuery,
  ListMyOrganizationsQuery,
  ListOrganizationsQuery,
  MemberDto,
  MembershipRole,
  MembershipSettingsDto,
  MyOrganizationDto,
  OrganizationDto,
  UpdateOrganizationBody,
} from "./organization.schema.js";

// No 0/O or 1/I, so a code read aloud or copied by hand stays correct.
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 8;

const JOIN_REFUSAL_MESSAGES: Record<JoinRefusal, string> = {
  USER_NOT_FOUND: "User not found",
  USER_IN_ANOTHER_ORGANIZATION:
    "This user is already in an organization and may not join another",
  ORGANIZATION_NOT_FOUND: "Organization not found",
  ORGANIZATION_INACTIVE: "This organization is deactivated",
  ORGANIZATION_FULL: "This organization has no free seats",
  ALREADY_MEMBER: "This user is already a member",
};

// 32^8 ≈ 10^12 codes, so a clash is very unlikely; if one happens the unique index
// answers 409 and the admin can try again.
function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export class OrganizationService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly userAuth: UserAuthService
  ) {}

  // ===========================================================================
  // Admin panel
  // ===========================================================================

  async list(
    query: ListOrganizationsQuery
  ): Promise<Paginated<OrganizationDto>> {
    const { items, total } = await this.organizations.listOrganizations(query);
    return paginated(items, total, query);
  }

  async getById(id: string): Promise<OrganizationDto> {
    const organization = await this.organizations.findOrganizationById(id);
    if (!organization) throw ApiError.notFound("Organization not found");
    return organization;
  }

  // A duplicate slug hits the unique index and becomes a 409 in errorHandler.
  create(
    input: CreateOrganizationBody,
    createdByAdminId: string
  ): Promise<OrganizationDto> {
    return this.organizations.createOrganization({
      ...input,
      joinCode: generateJoinCode(),
      createdByAdminId,
    });
  }

  async update(
    id: string,
    input: UpdateOrganizationBody
  ): Promise<OrganizationDto> {
    return this.applyUpdate(id, input);
  }

  async regenerateJoinCode(id: string): Promise<OrganizationDto> {
    return this.applyUpdate(id, { joinCode: generateJoinCode() });
  }

  async listMembers(
    organizationId: string,
    query: ListMembersQuery
  ): Promise<Paginated<MemberDto>> {
    await this.getById(organizationId);
    const { items, total } = await this.organizations.listMembers(
      organizationId,
      query
    );
    return paginated(items, total, query);
  }

  // Makes an existing app user an organization admin: adds them (join rule) or promotes
  // their ACTIVE membership. The person must have signed in to the app once.
  async addOrganizationAdmin(
    organizationId: string,
    email: string
  ): Promise<{ member: MemberDto; isNewMember: boolean }> {
    await this.getById(organizationId);
    const userId = await this.userAuth.findActiveUserIdByEmail(email);
    if (!userId) {
      throw ApiError.notFound(
        "No app user with this email. They must sign in to the app once first"
      );
    }

    const result = await this.addMember({
      organizationId,
      userId,
      role: "ORGANIZATION_ADMIN",
      joinMethod: "ADDED_BY_ADMIN",
      sharePastDataWithOrganization: false,
    });
    if ("member" in result) return { member: result.member, isNewMember: true };
    if (result.refusedBecause !== "ALREADY_MEMBER") {
      throw ApiError.conflict(JOIN_REFUSAL_MESSAGES[result.refusedBecause]);
    }

    if (
      !(await this.organizations.promoteToOrganizationAdmin(
        organizationId,
        userId
      ))
    ) {
      throw ApiError.conflict("This user's membership is suspended");
    }
    const member = await this.organizations.findMember(organizationId, userId);
    if (!member) throw ApiError.notFound("Organization not found");
    return { member, isNewMember: false };
  }

  async updateMembershipSettings(
    userId: string,
    canJoinMultipleOrganizations: boolean
  ): Promise<MembershipSettingsDto> {
    const result = await this.organizations.updateMembershipSettings(
      userId,
      canJoinMultipleOrganizations
    );
    if (result === "NOT_FOUND") throw ApiError.notFound("User not found");
    if (result === "IN_SEVERAL_ORGANIZATIONS") {
      throw ApiError.conflict(
        "This user is in several organizations. They must leave all but one first"
      );
    }
    return result;
  }

  // ===========================================================================
  // App (user panel)
  // ===========================================================================

  async listMyOrganizations(
    userId: string,
    query: ListMyOrganizationsQuery
  ): Promise<Paginated<MyOrganizationDto>> {
    const { items, total } = await this.organizations.listMyOrganizations(
      userId,
      query
    );
    return paginated(items, total, query);
  }

  async getCurrent(
    membership: ActiveMembership,
    userId: string
  ): Promise<MyOrganizationDto> {
    const [organization, member] = await Promise.all([
      this.organizations.findOrganizationById(membership.organizationId),
      this.organizations.findMember(membership.organizationId, userId),
    ]);
    if (!organization || !member) {
      throw ApiError.notFound("Organization not found");
    }
    return {
      organization: {
        id: organization.id,
        name: organization.name,
        type: organization.type,
        slug: organization.slug,
      },
      membership: {
        id: member.id,
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt,
      },
    };
  }

  async getJoinCode(organizationId: string): Promise<JoinCodeDto> {
    const joinCode = await this.organizations.findJoinCode(organizationId);
    if (!joinCode) throw ApiError.notFound("Organization not found");
    return joinCode;
  }

  async setJoinCodeEnabled(
    organizationId: string,
    isJoinCodeEnabled: boolean
  ): Promise<JoinCodeDto> {
    const { joinCode } = await this.applyUpdate(organizationId, {
      isJoinCodeEnabled,
    });
    return { joinCode, isJoinCodeEnabled };
  }

  async regenerateOwnJoinCode(organizationId: string): Promise<JoinCodeDto> {
    const { joinCode, isJoinCodeEnabled } =
      await this.regenerateJoinCode(organizationId);
    return { joinCode, isJoinCodeEnabled };
  }

  // ===========================================================================
  // Used by guards and other modules
  // ===========================================================================

  // For requireOrganizationRole. Not a member (or the organization is deactivated) → 404,
  // suspended → 403, wrong role → 403.
  async getMembershipForRequest(
    organizationId: string,
    userId: string,
    allowedRoles: readonly MembershipRole[]
  ): Promise<ActiveMembership> {
    const membership = await this.organizations.findSeatHoldingMembership(
      organizationId,
      userId
    );
    if (!membership) throw ApiError.notFound("Organization not found");
    if (membership.status === "SUSPENDED") {
      throw ApiError.forbidden("Your membership is suspended");
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
      throw ApiError.forbidden("Your role in this organization can't do this");
    }
    const { status: _status, ...activeMembership } = membership;
    return activeMembership;
  }

  // The join rule (see OrganizationRepository.joinOrganization). Invites and join
  // requests call this in later steps.
  addMember(input: JoinOrganizationInput) {
    return this.organizations.joinOrganization(input);
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async applyUpdate(
    id: string,
    fields: Parameters<OrganizationRepository["updateOrganization"]>[1]
  ): Promise<OrganizationDto> {
    const result = await this.organizations.updateOrganization(id, fields);
    if (result === "NOT_FOUND")
      throw ApiError.notFound("Organization not found");
    if (result === "BELOW_MEMBER_COUNT") {
      throw ApiError.conflict(
        "maxMembers can't be below the current number of members"
      );
    }
    return result;
  }
}

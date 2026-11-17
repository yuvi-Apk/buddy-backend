import { ApiError } from "../../../utils/ApiError.js";
import { paginated, type Paginated } from "../../../utils/pagination.js";
import type { ClassroomService } from "../classroom/index.js";
import type {
  ActiveMembership,
  JoinRefusal,
  OrganizationService,
} from "../../shared/organization/index.js";
import type { JoinRequestRepository } from "./join-request.repository.js";
import type {
  ApprovedJoinRequestDto,
  ApproveJoinRequestBody,
  CreateJoinRequestBody,
  JoinRequestForReviewDto,
  ListJoinRequestsQuery,
  MyJoinRequestDto,
} from "./join-request.schema.js";

// Messages for the organization admin approving the request.
const JOIN_REFUSAL_MESSAGES: Record<JoinRefusal, string> = {
  USER_NOT_FOUND: "This person's account is disabled",
  USER_IN_ANOTHER_ORGANIZATION:
    "This person is already in another organization and may not join a second one",
  ORGANIZATION_NOT_FOUND: "This organization is deactivated",
  ORGANIZATION_INACTIVE: "This organization is deactivated",
  ORGANIZATION_FULL: "This organization has no free seats",
  ALREADY_MEMBER: "This person is already a member",
};

export class JoinRequestService {
  constructor(
    private readonly joinRequests: JoinRequestRepository,
    private readonly organizations: OrganizationService,
    private readonly classrooms: ClassroomService
  ) {}

  // ===========================================================================
  // The person asking
  // ===========================================================================

  async create(
    userId: string,
    input: CreateJoinRequestBody
  ): Promise<MyJoinRequestDto> {
    const organization = await this.organizations.findJoinableByCode(
      input.joinCode
    );
    if (!organization) {
      throw ApiError.notFound("No organization with this join code");
    }
    if (await this.organizations.isSeatHoldingMember(organization.id, userId)) {
      throw ApiError.conflict("You are already a member of this organization");
    }
    if (!(await this.organizations.hasRoomForAnotherMembership(userId))) {
      throw ApiError.conflict(
        "You are already in an organization. Leave it before joining another"
      );
    }

    const created = await this.joinRequests.create({
      userId,
      organizationId: organization.id,
      requestedRole: input.requestedRole,
      requesterNote: input.requesterNote,
      sharePastDataWithOrganization: input.sharePastDataWithOrganization,
    });
    if (created === "DUPLICATE") {
      throw ApiError.conflict(
        "You already have a pending request for this organization"
      );
    }
    return created;
  }

  async listMine(
    userId: string,
    query: ListJoinRequestsQuery
  ): Promise<Paginated<MyJoinRequestDto>> {
    const { items, total } = await this.joinRequests.listMine(userId, query);
    return paginated(items, total, query);
  }

  async cancel(
    userId: string,
    joinRequestId: string
  ): Promise<MyJoinRequestDto> {
    const result = await this.joinRequests.cancel(userId, joinRequestId);
    if (result === "NOT_FOUND") throw ApiError.notFound("Request not found");
    if (result === "NOT_PENDING") {
      throw ApiError.conflict("Only a pending request can be cancelled");
    }
    return result;
  }

  // ===========================================================================
  // Organization admins
  // ===========================================================================

  async listForReview(
    caller: ActiveMembership,
    query: ListJoinRequestsQuery
  ): Promise<Paginated<JoinRequestForReviewDto>> {
    const { items, total } = await this.joinRequests.listForReview(
      caller.organizationId,
      query
    );
    return paginated(items, total, query);
  }

  // Mark APPROVED first (so a parallel reject or cancel can't also win), then run the join
  // rule. If joining is refused, the request goes back to PENDING.
  async approve(
    caller: ActiveMembership,
    reviewerUserId: string,
    joinRequestId: string,
    input: ApproveJoinRequestBody
  ): Promise<ApprovedJoinRequestDto> {
    const { organizationId } = caller;
    const request = await this.getPendingForApproval(
      organizationId,
      joinRequestId
    );
    if (input.classroomId) {
      await this.classrooms.assertCanAddMembersTo(
        organizationId,
        input.classroomId
      );
    }

    const claimed = await this.joinRequests.review({
      organizationId,
      joinRequestId,
      status: "APPROVED",
      reviewedByUserId: reviewerUserId,
      reviewNote: input.reviewNote,
    });
    if (!claimed) throw this.notPending();

    let joined: Awaited<ReturnType<OrganizationService["addMember"]>>;
    try {
      joined = await this.organizations.addMember({
        organizationId,
        userId: request.userId,
        role: input.role ?? request.requestedRole,
        joinMethod: "APPROVED_JOIN_REQUEST",
        sharePastDataWithOrganization: request.sharePastDataWithOrganization,
      });
    } catch (err) {
      await this.joinRequests.releaseApproval(joinRequestId);
      throw err;
    }
    if ("refusedBecause" in joined) {
      await this.joinRequests.releaseApproval(joinRequestId);
      throw ApiError.conflict(JOIN_REFUSAL_MESSAGES[joined.refusedBecause]);
    }

    if (input.classroomId) {
      await this.classrooms.addMemberAfterJoining(
        organizationId,
        input.classroomId,
        joined.member.id
      );
    }
    return {
      joinRequest: await this.getForReview(organizationId, joinRequestId),
      membershipId: joined.member.id,
    };
  }

  async reject(
    caller: ActiveMembership,
    reviewerUserId: string,
    joinRequestId: string,
    reviewNote: string | undefined
  ): Promise<JoinRequestForReviewDto> {
    const { organizationId } = caller;
    await this.getForReview(organizationId, joinRequestId);
    const rejected = await this.joinRequests.review({
      organizationId,
      joinRequestId,
      status: "REJECTED",
      reviewedByUserId: reviewerUserId,
      reviewNote,
    });
    if (!rejected) throw this.notPending();
    return this.getForReview(organizationId, joinRequestId);
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  // Another organization's request answers 404 (core-rules #8).
  private async getForReview(
    organizationId: string,
    joinRequestId: string
  ): Promise<JoinRequestForReviewDto> {
    const request = await this.joinRequests.findForReview(
      organizationId,
      joinRequestId
    );
    if (!request) throw ApiError.notFound("Request not found");
    return request;
  }

  private async getPendingForApproval(
    organizationId: string,
    joinRequestId: string
  ) {
    const request = await this.joinRequests.findPendingForApproval(
      organizationId,
      joinRequestId
    );
    if (request) return request;
    await this.getForReview(organizationId, joinRequestId); // 404 when not ours
    throw this.notPending();
  }

  private notPending(): ApiError {
    return ApiError.conflict("This request has already been handled");
  }
}

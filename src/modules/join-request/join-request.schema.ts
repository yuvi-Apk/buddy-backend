import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

// Nobody can ask to be an organization admin (join_requests_role_ck).
export const REQUESTABLE_ROLES = ["STUDENT", "TEACHER"] as const;
export type RequestableRole = (typeof REQUESTABLE_ROLES)[number];

export const JOIN_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];

const note = z.string().trim().min(1).max(500);

// ===========================================================================
// The person asking to join
// ===========================================================================

export const createJoinRequestBody = z.strictObject({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,16}$/, "Invalid join code"),
  requestedRole: z.enum(REQUESTABLE_ROLES).default("STUDENT"),
  requesterNote: note.optional(),
  // Joining shares nothing from before unless the person says so.
  sharePastDataWithOrganization: z.boolean().default(false),
});
export type CreateJoinRequestBody = z.infer<typeof createJoinRequestBody>;

export const listJoinRequestsQuery = paginationQuery.extend({
  status: z.enum(JOIN_REQUEST_STATUSES).optional(),
});
export type ListJoinRequestsQuery = z.infer<typeof listJoinRequestsQuery>;

export const joinRequestIdParams = z.strictObject({ id: z.uuid() });
export type JoinRequestIdParams = z.infer<typeof joinRequestIdParams>;

// ===========================================================================
// Organization admins
// ===========================================================================

export const approveJoinRequestBody = z.strictObject({
  // Overrides the role the person asked for.
  role: z.enum(REQUESTABLE_ROLES).optional(),
  classroomId: z.uuid().optional(),
  reviewNote: note.optional(),
});
export type ApproveJoinRequestBody = z.infer<typeof approveJoinRequestBody>;

export const rejectJoinRequestBody = z.strictObject({
  reviewNote: note.optional(),
});
export type RejectJoinRequestBody = z.infer<typeof rejectJoinRequestBody>;

// ===========================================================================
// What the API returns
// ===========================================================================

// For the person who asked.
export interface MyJoinRequestDto {
  id: string;
  organization: { id: string; name: string; type: string };
  requestedRole: RequestableRole;
  status: JoinRequestStatus;
  requesterNote: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

// For organization admins reviewing it.
export interface JoinRequestForReviewDto {
  id: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
  requestedRole: RequestableRole;
  status: JoinRequestStatus;
  requesterNote: string | null;
  sharePastDataWithOrganization: boolean;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface ApprovedJoinRequestDto {
  joinRequest: JoinRequestForReviewDto;
  membershipId: string;
}

import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

export const INVITE_ROLES = [
  "STUDENT",
  "TEACHER",
  "ORGANIZATION_ADMIN",
] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

// EXPIRED is shown for a PENDING invite past its expiresAt too.
export const INVITE_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

// The raw token is 32 random bytes in base64url (43 characters).
const inviteToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invite token");

export const createInviteBody = z.strictObject({
  inviteeEmail: z.email().trim().toLowerCase().max(254),
  roleOnJoin: z.enum(INVITE_ROLES).default("STUDENT"),
  classroomId: z.uuid().optional(),
});
export type CreateInviteBody = z.infer<typeof createInviteBody>;

export const listInvitesQuery = paginationQuery.extend({
  status: z.enum(INVITE_STATUSES).optional(),
});
export type ListInvitesQuery = z.infer<typeof listInvitesQuery>;

export const listReceivedInvitesQuery = paginationQuery;
export type ListReceivedInvitesQuery = z.infer<typeof listReceivedInvitesQuery>;

// Joining shares nothing from before unless the person says so.
const sharePastDataWithOrganization = z.boolean().default(false);

export const acceptInviteByTokenBody = z.strictObject({
  token: inviteToken,
  sharePastDataWithOrganization,
});
export type AcceptInviteByTokenBody = z.infer<typeof acceptInviteByTokenBody>;

export const acceptInviteBody = z.strictObject({
  sharePastDataWithOrganization,
});
export type AcceptInviteBody = z.infer<typeof acceptInviteBody>;

export const inviteIdParams = z.strictObject({ id: z.uuid() });
export type InviteIdParams = z.infer<typeof inviteIdParams>;

// /admin/organizations/:organizationId/invites
export const adminOrganizationParams = z.strictObject({
  organizationId: z.uuid(),
});
export type AdminOrganizationParams = z.infer<typeof adminOrganizationParams>;

export const adminInviteParams = z.strictObject({
  organizationId: z.uuid(),
  inviteId: z.uuid(),
});
export type AdminInviteParams = z.infer<typeof adminInviteParams>;

// ===========================================================================
// What the API returns
// ===========================================================================

// For the organization admin or admin who sent it.
export interface InviteDto {
  id: string;
  inviteeEmail: string;
  roleOnJoin: InviteRole;
  status: InviteStatus;
  classroom: { id: string; name: string } | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

// Returned once, when the invite is created. Only the token's hash is stored.
export interface CreatedInviteDto {
  invite: InviteDto;
  inviteLink: string;
}

// For the person invited.
export interface ReceivedInviteDto {
  id: string;
  organization: { id: string; name: string; type: string };
  roleOnJoin: InviteRole;
  classroom: { id: string; name: string } | null;
  expiresAt: Date;
}

export interface AcceptedInviteDto {
  organizationId: string;
  membershipId: string;
  role: InviteRole;
}

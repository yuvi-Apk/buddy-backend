import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

// Same values as the Prisma enums; kept here so guards and schemas never import Prisma.
export const ORGANIZATION_TYPES = [
  "SCHOOL",
  "COLLEGE",
  "COACHING",
  "OTHER",
] as const;
export const MEMBERSHIP_ROLES = [
  "STUDENT",
  "TEACHER",
  "ORGANIZATION_ADMIN",
] as const;
export const MEMBERSHIP_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "LEFT",
  "REMOVED",
] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export type JoinMethod =
  "ADDED_BY_ADMIN" | "ACCEPTED_INVITE" | "APPROVED_JOIN_REQUEST";

// The header the app sends on organization routes.
export const ORGANIZATION_ID_HEADER = "x-organization-id";

const organizationName = z.string().trim().min(2).max(120);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, digits and single dashes"
  )
  .min(3)
  .max(60);
const maxMembers = z.number().int().min(1).max(1_000_000);
const queryBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

// ===========================================================================
// Admin panel
// ===========================================================================

export const createOrganizationBody = z.strictObject({
  name: organizationName,
  type: z.enum(ORGANIZATION_TYPES).default("SCHOOL"),
  slug,
  maxMembers: maxMembers.nullable().default(null), // null = unlimited
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationBody>;

export const updateOrganizationBody = z
  .strictObject({
    name: organizationName.optional(),
    type: z.enum(ORGANIZATION_TYPES).optional(),
    slug: slug.optional(),
    maxMembers: maxMembers.nullable().optional(),
    isJoinCodeEnabled: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change",
  });
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBody>;

export const organizationIdParams = z.strictObject({ id: z.uuid() });
export type OrganizationIdParams = z.infer<typeof organizationIdParams>;

export const listOrganizationsQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(60).optional(),
  isActive: queryBoolean.optional(),
});
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuery>;

export const listMembersQuery = paginationQuery.extend({
  role: z.enum(MEMBERSHIP_ROLES).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuery>;

export const addOrganizationAdminBody = z.strictObject({
  email: z.email().trim().toLowerCase().max(254),
});
export type AddOrganizationAdminBody = z.infer<typeof addOrganizationAdminBody>;

export const userIdParams = z.strictObject({ userId: z.uuid() });
export type UserIdParams = z.infer<typeof userIdParams>;

export const updateMembershipSettingsBody = z.strictObject({
  canJoinMultipleOrganizations: z.boolean(),
});
export type UpdateMembershipSettingsBody = z.infer<
  typeof updateMembershipSettingsBody
>;

// ===========================================================================
// App (user panel)
// ===========================================================================

export const listMyOrganizationsQuery = paginationQuery;
export type ListMyOrganizationsQuery = z.infer<typeof listMyOrganizationsQuery>;

export const updateJoinCodeBody = z.strictObject({
  isJoinCodeEnabled: z.boolean(),
});
export type UpdateJoinCodeBody = z.infer<typeof updateJoinCodeBody>;

// ===========================================================================
// What the API returns
// ===========================================================================

export interface OrganizationDto {
  id: string;
  name: string;
  type: OrganizationType;
  slug: string;
  joinCode: string;
  isJoinCodeEnabled: boolean;
  plan: string;
  maxMembers: number | null; // null = unlimited
  activeMemberCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberDto {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  joinMethod: JoinMethod;
  joinedAt: Date;
  leftAt: Date | null;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
}

export interface MembershipSettingsDto {
  userId: string;
  canJoinMultipleOrganizations: boolean;
  activeMembershipCount: number;
}

// One of the signed-in user's organizations, as the app lists them.
export interface MyOrganizationDto {
  organization: {
    id: string;
    name: string;
    type: OrganizationType;
    slug: string;
  };
  membership: {
    id: string;
    role: MembershipRole;
    status: MembershipStatus;
    joinedAt: Date;
  };
}

export interface JoinCodeDto {
  joinCode: string;
  isJoinCodeEnabled: boolean;
}

// Set on req.membership by requireOrganizationRole.
export interface ActiveMembership {
  id: string;
  organizationId: string;
  role: MembershipRole;
}

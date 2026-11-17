import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

const adminName = z.string().trim().min(2).max(80);
const queryBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

// The admin signs in with the Google account of this email; it is linked on first sign-in.
// Email can't be edited: disable the account and create a new one instead.
export const createAdminBody = z.strictObject({
  name: adminName,
  email: z.email().trim().toLowerCase().max(254),
  roleId: z.uuid(),
});
export type CreateAdminBody = z.infer<typeof createAdminBody>;

export const updateAdminBody = z
  .strictObject({
    name: adminName.optional(),
    roleId: z.uuid().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change",
  });
export type UpdateAdminBody = z.infer<typeof updateAdminBody>;

export const adminIdParams = z.strictObject({ id: z.uuid() });
export type AdminIdParams = z.infer<typeof adminIdParams>;

export const listAdminsQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(80).optional(),
  roleId: z.uuid().optional(),
  isActive: queryBoolean.optional(),
});
export type ListAdminsQuery = z.infer<typeof listAdminsQuery>;

// What the API returns for an admin. The Google account id itself is never returned.
export interface AdminDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isActive: boolean;
  isGoogleLinked: boolean;
  role: { id: string; name: string };
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

import { z } from "zod";
import { PAGES } from "../../config/rbac.config.js";
import { paginationQuery } from "../../utils/pagination.js";

const roleName = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z][A-Z0-9_]{1,49}$/,
    "Use 2-50 letters, digits or underscores, starting with a letter"
  );

// Only pages defined in rbac.config.ts are accepted. Duplicates are removed.
const pages = z.array(z.enum(PAGES)).transform((list) => [...new Set(list)]);

export const createRoleBody = z.strictObject({
  name: roleName,
  description: z.string().trim().max(255).optional(),
  pages: pages.default([]),
});
export type CreateRoleBody = z.infer<typeof createRoleBody>;

export const updateRoleBody = z
  .strictObject({
    name: roleName.optional(),
    description: z.string().trim().max(255).nullable().optional(),
    pages: pages.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change",
  });
export type UpdateRoleBody = z.infer<typeof updateRoleBody>;

export const roleIdParams = z.strictObject({ id: z.uuid() });
export type RoleIdParams = z.infer<typeof roleIdParams>;

export const listRolesQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(50).optional(),
});
export type ListRolesQuery = z.infer<typeof listRolesQuery>;

// What the API returns for a role.
export interface RoleDto {
  id: string;
  name: string;
  description: string | null;
  // Pages this role may access.
  pages: string[];
  createdAt: Date;
  updatedAt: Date;
}

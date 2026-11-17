import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

const classroomName = z.string().trim().min(1).max(80);
const academicYear = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2,4})?$/, "Use a year like 2026 or 2026-27");
const queryBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

export const createClassroomBody = z.strictObject({
  name: classroomName,
  academicYear: academicYear.optional(),
});
export type CreateClassroomBody = z.infer<typeof createClassroomBody>;

export const updateClassroomBody = z
  .strictObject({
    name: classroomName.optional(),
    academicYear: academicYear.nullable().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change",
  });
export type UpdateClassroomBody = z.infer<typeof updateClassroomBody>;

export const classroomIdParams = z.strictObject({ id: z.uuid() });
export type ClassroomIdParams = z.infer<typeof classroomIdParams>;

export const classroomMemberParams = z.strictObject({
  id: z.uuid(),
  membershipId: z.uuid(),
});
export type ClassroomMemberParams = z.infer<typeof classroomMemberParams>;

export const listClassroomsQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(80).optional(),
  isArchived: queryBoolean.default(false),
});
export type ListClassroomsQuery = z.infer<typeof listClassroomsQuery>;

export const listClassroomMembersQuery = paginationQuery.extend({
  role: z.enum(["STUDENT", "TEACHER", "ORGANIZATION_ADMIN"]).optional(),
});
export type ListClassroomMembersQuery = z.infer<
  typeof listClassroomMembersQuery
>;

export const addClassroomMemberBody = z.strictObject({
  membershipId: z.uuid(),
});
export type AddClassroomMemberBody = z.infer<typeof addClassroomMemberBody>;

// What the API returns.

export interface ClassroomDto {
  id: string;
  name: string;
  academicYear: string | null;
  isArchived: boolean;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClassroomMemberDto {
  membershipId: string;
  role: "STUDENT" | "TEACHER" | "ORGANIZATION_ADMIN";
  addedAt: Date;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
}

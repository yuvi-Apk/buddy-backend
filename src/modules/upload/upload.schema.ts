import { z } from "zod";
import { UPLOAD_FOLDERS } from "../../config/upload.config.js";
import { paginationQuery } from "../../utils/pagination.js";

// Text fields sent next to the file in the multipart form.
export const uploadImageBody = z.strictObject({
  folder: z.enum(UPLOAD_FOLDERS).default("general"),
});
export type UploadImageBody = z.infer<typeof uploadImageBody>;

export const uploadIdParams = z.strictObject({ id: z.uuid() });
export type UploadIdParams = z.infer<typeof uploadIdParams>;

export const listUploadsQuery = paginationQuery.extend({
  folder: z.enum(UPLOAD_FOLDERS).optional(),
});
export type ListUploadsQuery = z.infer<typeof listUploadsQuery>;

/** What the API returns for an uploaded file. */
export interface UploadedFileDto {
  id: string;
  url: string;
  folder: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

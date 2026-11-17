import type { PrismaClient } from "../../../config/prisma.js";
import { toSkipTake } from "../../../utils/pagination.js";
import type { ListUploadsQuery, UploadedFileDto } from "./upload.schema.js";

const fileSelect = {
  id: true,
  url: true,
  folder: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

export class UploadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: {
    url: string;
    folder: string;
    contentType: string;
    sizeBytes: number;
    uploadedByAdminId: string;
  }): Promise<UploadedFileDto> {
    return this.prisma.upload.create({ data: input, select: fileSelect });
  }

  findById(id: string): Promise<UploadedFileDto | null> {
    return this.prisma.upload.findUnique({
      where: { id },
      select: fileSelect,
    });
  }

  async list(
    query: ListUploadsQuery
  ): Promise<{ items: UploadedFileDto[]; total: number }> {
    const where = query.folder ? { folder: query.folder } : {};
    const [items, total] = await Promise.all([
      this.prisma.upload.findMany({
        where,
        select: fileSelect,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(query),
      }),
      this.prisma.upload.count({ where }),
    ]);
    return { items, total };
  }

  // Returns true when a row was deleted.
  async delete(id: string): Promise<boolean> {
    const { count } = await this.prisma.upload.deleteMany({
      where: { id },
    });
    return count === 1;
  }
}

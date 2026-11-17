import type { UploadFolder } from "../../../config/upload.config.js";
import type { StorageProvider } from "../../../core/storage/StorageProvider.js";
import { ApiError } from "../../../utils/ApiError.js";
import { paginated, type Paginated } from "../../../utils/pagination.js";
import { uploadAndCompressImage } from "../../../utils/uploadAndCompressImage.js";
import type { UploadRepository } from "./upload.repository.js";
import type { ListUploadsQuery, UploadedFileDto } from "./upload.schema.js";

export class UploadService {
  constructor(
    private readonly uploads: UploadRepository,
    private readonly storage: StorageProvider
  ) {}

  // Checks, compresses and stores an image that multer saved to a temp path.
  async uploadImage(input: {
    tempPath: string;
    folder: UploadFolder;
    uploadedByAdminId: string;
  }): Promise<UploadedFileDto> {
    const image = await uploadAndCompressImage(
      input.tempPath,
      { uploadFolder: input.folder },
      this.storage
    );

    try {
      return await this.uploads.create({
        ...image,
        folder: input.folder,
        uploadedByAdminId: input.uploadedByAdminId,
      });
    } catch (err) {
      // Do not leave a stored file behind without a database row.
      await this.storage.delete(image.url);
      throw err;
    }
  }

  async list(query: ListUploadsQuery): Promise<Paginated<UploadedFileDto>> {
    const { items, total } = await this.uploads.list(query);
    return paginated(items, total, query);
  }

  // Deletes by ID, never by a path from the client: only files this app stored and
  // recorded can be removed.
  async delete(id: string): Promise<void> {
    const file = await this.uploads.findById(id);
    if (!file) throw ApiError.notFound("File not found");

    // Row first: if two requests race, only one gets to delete the stored file.
    if (await this.uploads.delete(id)) {
      await this.storage.delete(file.url);
    }
  }
}

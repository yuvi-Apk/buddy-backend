// Where uploaded files are kept. Today: the local disk. To move to S3 or Cloudinary:
//   1. write a class here that implements StorageProvider
//   2. add its name to STORAGE_DRIVER in src/config/env.ts
//   3. choose it in src/container.ts
// Nothing else in the codebase needs to change.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PUBLIC_IMAGES_DIR,
  PUBLIC_IMAGES_URL,
  type UploadFolder,
} from "../../config/upload.config.js";
import { deleteLocalFile } from "../../utils/deleteLocalFile.js";

export interface StorageProvider {
  // Saves the file and returns the URL to store in the database.
  save(file: {
    folder: UploadFolder;
    fileName: string;
    data: Buffer;
    contentType: string;
  }): Promise<string>;

  // Deletes a file by the URL that save() returned.
  delete(url: string): Promise<void>;
}

// Saves files under public/images/<folder> and serves them from /images/<folder>.
export class LocalStorageProvider implements StorageProvider {
  async save(file: {
    folder: UploadFolder;
    fileName: string;
    data: Buffer;
  }): Promise<string> {
    const directory = path.join(PUBLIC_IMAGES_DIR, file.folder);
    await mkdir(directory, { recursive: true });
    // basename() guarantees the name cannot point outside the folder.
    const fileName = path.basename(file.fileName);
    await writeFile(path.join(directory, fileName), file.data);
    return `${PUBLIC_IMAGES_URL}/${file.folder}/${fileName}`;
  }

  async delete(url: string): Promise<void> {
    await deleteLocalFile(url);
  }
}

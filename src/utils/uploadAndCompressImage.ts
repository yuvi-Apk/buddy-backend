import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  ALLOWED_IMAGE_FORMATS,
  isUploadFolder,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_WIDTH,
  MIN_IMAGE_WIDTH,
} from "../config/upload.config.js";
import type { StorageProvider } from "../core/storage/StorageProvider.js";
import { ApiError } from "./ApiError.js";
import { deleteLocalFile } from "./deleteLocalFile.js";

interface ImageUploadOptions {
  size?: number; // target size in KB (default: 100)
  uploadFolder: string; // must be one of UPLOAD_FOLDERS, e.g. "general", "profile"
}

export interface UploadedImage {
  url: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * Checks that the multer temp file really is an image, converts it to WebP at or under
 * the target size, saves it through the storage provider and removes the temp file.
 * Returns the URL to store in the database.
 */
export const uploadAndCompressImage = async (
  inputPath: string, // multer file path
  options: ImageUploadOptions,
  storage: StorageProvider
): Promise<UploadedImage> => {
  const { size = 100, uploadFolder } = options;

  try {
    if (!isUploadFolder(uploadFolder)) {
      throw ApiError.badRequest("Unknown upload folder");
    }

    // The file extension and the MIME type sent by the client can both be faked.
    // sharp reads the actual bytes: anything that is not a real image fails here.
    const metadata = await sharp(inputPath, {
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .metadata()
      .catch(() => null);
    if (!metadata?.format || !ALLOWED_IMAGE_FORMATS.includes(metadata.format)) {
      throw ApiError.badRequest("File is not a valid JPEG, PNG or WebP image");
    }

    const encode = (width: number, quality: number) =>
      sharp(inputPath, { limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate() // apply the camera orientation; EXIF data (incl. GPS) is dropped
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
    const fits = (buffer: Buffer) => buffer.length / 1024 <= size;

    // 1. Lower the quality step by step until the file fits the target size.
    let width = Math.min(metadata.width ?? MAX_IMAGE_WIDTH, MAX_IMAGE_WIDTH);
    let data = await encode(width, 80);
    for (let quality = 70; quality >= 30 && !fits(data); quality -= 10) {
      data = await encode(width, quality);
    }

    // 2. Very detailed images can still be too big at the lowest quality.
    //    Then make the picture smaller until it fits.
    while (!fits(data) && width > MIN_IMAGE_WIDTH) {
      width = Math.max(MIN_IMAGE_WIDTH, Math.round(width * 0.75));
      data = await encode(width, 50);
    }

    const contentType = "image/webp";
    const url = await storage.save({
      folder: uploadFolder,
      fileName: `${randomUUID()}.webp`, // never the client's file name
      data,
      contentType,
    });
    return { url, sizeBytes: data.length, contentType };
  } finally {
    // Remove the multer temp file whether the upload worked or not.
    await deleteLocalFile(inputPath);
  }
};

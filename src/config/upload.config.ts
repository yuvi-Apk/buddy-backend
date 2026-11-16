// Upload limits and locations, in one place (core-rules #15).
import path from "node:path";

// Sub-folders of public/images that files may be saved into. Add new ones here.
export const UPLOAD_FOLDERS = ["general", "profile"] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export const isUploadFolder = (value: string): value is UploadFolder =>
  (UPLOAD_FOLDERS as readonly string[]).includes(value);

// What the client may send. The real type is checked again from the file's bytes.
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];
// Image formats, as detected by sharp, that are accepted.
export const ALLOWED_IMAGE_FORMATS = ["jpeg", "png", "webp"];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000; // stops "decompression bomb" images
export const MAX_IMAGE_WIDTH = 2000;
// Compression never shrinks an image below this width, even to reach the target size.
export const MIN_IMAGE_WIDTH = 320;

// Where saved images live on disk, and the URL prefix they are served from.
export const PUBLIC_IMAGES_DIR = path.resolve("public", "images");
export const PUBLIC_IMAGES_URL = "/images";

// Where multer puts a file while it is being checked. Emptied after every request.
export const TEMP_UPLOAD_DIR = path.resolve("tmp", "uploads");

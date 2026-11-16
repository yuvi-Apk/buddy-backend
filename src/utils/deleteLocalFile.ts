import { unlink } from "node:fs/promises";
import path from "node:path";
import {
  PUBLIC_IMAGES_DIR,
  PUBLIC_IMAGES_URL,
  TEMP_UPLOAD_DIR,
} from "../config/upload.config.js";

// The only folders this function is allowed to delete from.
const DELETABLE_ROOTS = [PUBLIC_IMAGES_DIR, TEMP_UPLOAD_DIR];

const isInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

// Deletes a local file safely. Accepts:
//  - relative URL: /images/general/abc.webp
//  - relative path: public/images/general/abc.webp
//  - absolute path
//
// Refuses (and returns false for) anything outside the upload folders, so a crafted
// path such as "../../.env" can never delete another file (core-rules #15).
// Returns true when a file was deleted.
export const deleteLocalFile = async (filePath: string): Promise<boolean> => {
  if (!filePath) return false;

  // A URL path is converted to its place on disk.
  const onDisk = filePath.startsWith(`${PUBLIC_IMAGES_URL}/`)
    ? path.join(PUBLIC_IMAGES_DIR, filePath.slice(PUBLIC_IMAGES_URL.length))
    : filePath;
  const absolutePath = path.resolve(onDisk);

  if (!DELETABLE_ROOTS.some((root) => isInside(root, absolutePath))) {
    return false;
  }

  try {
    await unlink(absolutePath);
    return true;
  } catch {
    return false; // already gone
  }
};

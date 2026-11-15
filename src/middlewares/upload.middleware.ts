// File upload with limits (RULES.md #15).
//
//   router.post("/", verifyAdmin, requirePermission("UPLOAD"), uploadSingleImage("image"), ...)
//
// multer writes the file to a temp folder under a random name. The file is then checked and
// converted by uploadAndCompressImage. Whatever happens, the temp file is removed when the
// response ends.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { RequestHandler } from "express";
import multer from "multer";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  TEMP_UPLOAD_DIR,
} from "../config/upload.config.js";
import { ApiError } from "../utils/ApiError.js";
import { deleteLocalFile } from "../utils/deleteLocalFile.js";

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
      callback(null, TEMP_UPLOAD_DIR);
    },
    // The client's file name is never used on disk.
    filename: (_req, _file, callback) => callback(null, randomUUID()),
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 10 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(
        ApiError.badRequest("Only JPEG, PNG and WebP images are allowed")
      );
    }
  },
});

/** Accepts exactly one image in the given form field. The file ends up on req.file. */
export const uploadSingleImage = (fieldName: string): RequestHandler => {
  const parse = imageUpload.single(fieldName);

  return (req, res, next) => {
    // Safety net: remove the temp file once the response is done, even if a later step failed.
    res.on("close", () => {
      if (req.file?.path) void deleteLocalFile(req.file.path);
    });
    parse(req, res, next);
  };
};

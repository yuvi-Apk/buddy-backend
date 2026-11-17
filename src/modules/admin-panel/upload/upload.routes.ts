import { Router, type RequestHandler } from "express";
import type { PageName } from "../../../config/rbac.config.js";
import { uploadSingleImage } from "../../../middlewares/upload.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import type { UploadController } from "./upload.controller.js";
import {
  listUploadsQuery,
  uploadIdParams,
  uploadImageBody,
} from "./upload.schema.js";

interface Deps {
  verifyAdmin: RequestHandler;
  requirePermission: (page: PageName) => RequestHandler;
}

export function createUploadRouter(
  controller: UploadController,
  { verifyAdmin, requirePermission }: Deps
): Router {
  const router = Router();
  const canUpload = requirePermission("UPLOAD");

  // The guards run before multer, so nothing is written to disk for a caller without access.
  router.post(
    "/images",
    verifyAdmin,
    canUpload,
    uploadSingleImage("image"),
    validate({ body: uploadImageBody }),
    asyncHandler(controller.uploadImage)
  );

  router.get(
    "/",
    verifyAdmin,
    canUpload,
    validate({ query: listUploadsQuery }),
    asyncHandler(controller.list)
  );

  router.delete(
    "/:id",
    verifyAdmin,
    canUpload,
    validate({ params: uploadIdParams }),
    asyncHandler(controller.delete)
  );

  return router;
}

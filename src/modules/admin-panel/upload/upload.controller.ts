import type { Request, Response } from "express";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import type {
  ListUploadsQuery,
  UploadIdParams,
  UploadImageBody,
} from "./upload.schema.js";
import type { UploadService } from "./upload.service.js";

export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  uploadImage = async (req: Request, res: Response) => {
    if (!req.admin) throw ApiError.unauthorized();
    if (!req.file)
      throw ApiError.badRequest('Send the image in the "image" field');
    const { folder } = req.validated.body as UploadImageBody;

    const data = await this.uploadService.uploadImage({
      tempPath: req.file.path,
      folder,
      uploadedByAdminId: req.admin.id,
    });
    res.status(201).json(new ApiResponse(201, data, "Image uploaded"));
  };

  list = async (req: Request, res: Response) => {
    const query = req.validated.query as ListUploadsQuery;
    const data = await this.uploadService.list(query);
    res.status(200).json(new ApiResponse(200, data, "Files fetched"));
  };

  delete = async (req: Request, res: Response) => {
    const { id } = req.validated.params as UploadIdParams;
    await this.uploadService.delete(id);
    res.status(200).json(new ApiResponse(200, null, "File deleted"));
  };
}

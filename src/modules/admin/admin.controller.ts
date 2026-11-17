import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import type { AuthenticatedAdmin } from "../admin-auth/index.js";
import type {
  AdminIdParams,
  CreateAdminBody,
  ListAdminsQuery,
  UpdateAdminBody,
} from "./admin.schema.js";
import type { AdminService } from "./admin.service.js";

export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  list = async (req: Request, res: Response) => {
    const query = req.validated.query as ListAdminsQuery;
    const data = await this.adminService.list(query);
    res.status(200).json(new ApiResponse(200, data, "Admins fetched"));
  };

  getById = async (req: Request, res: Response) => {
    const { id } = req.validated.params as AdminIdParams;
    const data = await this.adminService.getById(id);
    res.status(200).json(new ApiResponse(200, data, "Admin fetched"));
  };

  create = async (req: Request, res: Response) => {
    const input = req.validated.body as CreateAdminBody;
    const data = await this.adminService.create(this.actor(req), input);
    res.status(201).json(new ApiResponse(201, data, "Admin created"));
  };

  update = async (req: Request, res: Response) => {
    const { id } = req.validated.params as AdminIdParams;
    const input = req.validated.body as UpdateAdminBody;
    const data = await this.adminService.update(this.actor(req), id, input);
    res.status(200).json(new ApiResponse(200, data, "Admin updated"));
  };

  private actor(req: Request): AuthenticatedAdmin {
    if (!req.admin) throw ApiError.unauthorized();
    return req.admin;
  }
}

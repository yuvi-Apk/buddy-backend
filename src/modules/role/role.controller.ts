import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import type { AuthenticatedAdmin } from "../admin-auth/index.js";
import type {
  CreateRoleBody,
  ListRolesQuery,
  RoleIdParams,
  UpdateRoleBody,
} from "./role.schema.js";
import type { RoleService } from "./role.service.js";

export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  list = async (req: Request, res: Response) => {
    const query = req.validated.query as ListRolesQuery;
    const data = await this.roleService.list(query);
    res.status(200).json(new ApiResponse(200, data, "Roles fetched"));
  };

  listPages = (_req: Request, res: Response) => {
    const data = this.roleService.listPages();
    res.status(200).json(new ApiResponse(200, data, "Pages fetched"));
  };

  getById = async (req: Request, res: Response) => {
    const { id } = req.validated.params as RoleIdParams;
    const data = await this.roleService.getById(id);
    res.status(200).json(new ApiResponse(200, data, "Role fetched"));
  };

  create = async (req: Request, res: Response) => {
    const input = req.validated.body as CreateRoleBody;
    const data = await this.roleService.create(input);
    res.status(201).json(new ApiResponse(201, data, "Role created"));
  };

  update = async (req: Request, res: Response) => {
    const { id } = req.validated.params as RoleIdParams;
    const input = req.validated.body as UpdateRoleBody;
    const data = await this.roleService.update(id, input, this.actor(req));
    res.status(200).json(new ApiResponse(200, data, "Role updated"));
  };

  delete = async (req: Request, res: Response) => {
    const { id } = req.validated.params as RoleIdParams;
    await this.roleService.delete(id, this.actor(req));
    res.status(200).json(new ApiResponse(200, null, "Role deleted"));
  };

  private actor(req: Request): AuthenticatedAdmin {
    if (!req.adminUser) throw ApiError.unauthorized();
    return req.adminUser;
  }
}

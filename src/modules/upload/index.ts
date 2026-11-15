// Public entry point of the upload module. Other code imports from here only.
import type { StorageProvider } from "../../core/storage/StorageProvider.js";
import type { Infra, RouterDeps } from "../../types/module.types.js";
import { UploadController } from "./upload.controller.js";
import { UploadRepository } from "./upload.repository.js";
import { createUploadRouter } from "./upload.routes.js";
import { UploadService } from "./upload.service.js";

export function createUploadModule(
  { prisma }: Infra,
  deps: { storage: StorageProvider }
) {
  const repository = new UploadRepository(prisma);
  const service = new UploadService(repository, deps.storage);
  const controller = new UploadController(service);

  return {
    router: ({ guards }: RouterDeps) => createUploadRouter(controller, guards),
  };
}

export type UploadModule = ReturnType<typeof createUploadModule>;
export type { UploadedFileDto } from "./upload.schema.js";

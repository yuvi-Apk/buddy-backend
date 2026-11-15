// Configuration for the Prisma CLI (migrate, generate). The running app does not use this file.
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// The CLI needs DATABASE_URL. Tests pass it in directly; otherwise it is loaded from .env.
if (!process.env["DATABASE_URL"] && existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Empty when no database is configured yet; `prisma generate` does not need it.
    url: process.env["DATABASE_URL"] ?? "",
  },
});

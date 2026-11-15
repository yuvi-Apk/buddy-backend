// Proves the ESLint guardrails in eslint.config.js really block what docs/RULES.md forbids.
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

// Fixture code is linted from memory (the files do not exist), so type-aware rules are
// switched off here. The import and syntax bans under test do not need type information.
const eslint = new ESLint({
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

async function ruleIdsFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "parse-error");
}

describe("ESLint guardrails", () => {
  it("blocks a controller importing Prisma", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/demo.controller.ts",
      'import { prisma } from "../../config/prisma.js";\nexport const x = prisma;\n'
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("blocks a controller importing a repository", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/demo.controller.ts",
      'import { DemoRepository } from "./demo.repository.js";\nexport const x = DemoRepository;\n'
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("blocks a middleware importing Prisma", async () => {
    const ids = await ruleIdsFor(
      "src/middlewares/admin/auth.middleware.ts",
      'import { prisma } from "../../config/prisma.js";\nexport const x = prisma;\n'
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("blocks a service importing another module's repository", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/demo.service.ts",
      'import { RoleRepository } from "../role/role.repository.js";\nexport const x = RoleRepository;\n'
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("blocks a module importing another module's files directly", async () => {
    for (const path of [
      "../session/session.service.js",
      "../session/session.schema.js",
    ]) {
      const ids = await ruleIdsFor(
        "src/modules/demo/demo.service.ts",
        `import type { X } from "${path}";\nexport type Y = X;\n`
      );
      expect(ids, path).toContain("no-restricted-imports");
    }
  });

  it("allows a module importing another module through its index.js", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/demo.service.ts",
      'import type { SessionService } from "../session/index.js";\nexport type Y = SessionService;\n'
    );
    expect(ids).not.toContain("no-restricted-imports");
  });

  it("blocks code outside modules from reaching past a module's index.js", async () => {
    for (const filePath of [
      "src/container.ts",
      "src/routes.ts",
      "src/middlewares/admin/auth.middleware.ts",
    ]) {
      const ids = await ruleIdsFor(
        filePath,
        'import { RoleService } from "./modules/role/role.service.js";\nexport const x = RoleService;\n'
      );
      expect(ids, filePath).toContain("no-restricted-imports");

      const viaIndex = await ruleIdsFor(
        filePath,
        'import { createRoleModule } from "./modules/role/index.js";\nexport const x = createRoleModule;\n'
      );
      expect(viaIndex, filePath).not.toContain("no-restricted-imports");
    }
  });

  it("allows a module's index.ts to build its own repository", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/index.ts",
      'import { DemoRepository } from "./demo.repository.js";\nexport const x = DemoRepository;\n'
    );
    expect(ids).not.toContain("no-restricted-imports");
  });

  it("allows a service importing its own repository", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/demo.service.ts",
      'import { DemoRepository } from "./demo.repository.js";\nexport const x = DemoRepository;\n'
    );
    expect(ids).not.toContain("no-restricted-imports");
  });

  it("allows a repository importing Prisma", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/demo.repository.ts",
      'import { prisma } from "../../config/prisma.js";\nexport const x = prisma;\n'
    );
    expect(ids).not.toContain("no-restricted-imports");
  });

  it("blocks process.env outside src/config/env.ts", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/demo.service.ts",
      "export const secret = process.env.SECRET;\n"
    );
    expect(ids).toContain("no-restricted-properties");
  });

  it("allows process.env inside src/config/env.ts", async () => {
    const ids = await ruleIdsFor(
      "src/config/env.ts",
      "export const raw = process.env;\n"
    );
    expect(ids).not.toContain("no-restricted-properties");
  });

  it("blocks unsafe raw SQL and console.log", async () => {
    const ids = await ruleIdsFor(
      "src/modules/demo/demo.repository.ts",
      'declare const db: { $queryRawUnsafe(q: string): unknown };\nexport const rows = db.$queryRawUnsafe("select 1");\nconsole.log(rows);\n'
    );
    expect(ids).toContain("no-restricted-syntax");
    expect(ids).toContain("no-console");
  });
});

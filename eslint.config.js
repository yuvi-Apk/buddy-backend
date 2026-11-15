// ESLint guardrails. The bans below enforce .claude/rules/core-rules.md #2, #5, #6, #18 and #22.
import tseslint from "typescript-eslint";

// --- import bans ------------------------------------------------------------

const prismaBan = {
  group: ["@prisma/client", "**/generated/prisma/**", "**/config/prisma.js"],
  message:
    "Only *.repository.ts files may use Prisma (core-rules #5). Call a service or repository instead.",
};

// A module's index.ts is its public entry point. From another module, only that file may be
// imported: "../session/index.js" is fine, "../session/session.service.js" is not.
const otherModuleDeepImportBan = {
  regex: "^\\.\\./[^./][^/]*/(?!index\\.js$)[^/]+$",
  message:
    "Import another module only through its index.js (core-rules #6), e.g. ../session/index.js.",
};

// The same rule for code outside src/modules (container, routes, middlewares, types).
const moduleDeepImportBan = {
  regex: "(^|/)modules/[^/]+/(?!index\\.js$)[^/]+$",
  message:
    "Import a module only through its index.js (core-rules #6), e.g. ./modules/session/index.js.",
};

const anyRepositoryBan = {
  group: ["*.repository.js", "**/*.repository.js"],
  message:
    "Only a service may use a repository (core-rules #5). Call the service instead.",
};

const restrictImports = (...patterns) => [
  "error",
  { patterns: patterns.map((p) => ({ ...p })) },
];

// --- config -----------------------------------------------------------------

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/generated/**",
      "coverage/**",
      "public/**",
      ".claude/**",
    ],
  },

  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // core-rules #2: env is read only in src/config/env.ts
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read env only through `env` from src/config/env.ts (core-rules #2).",
        },
      ],

      // core-rules #18: no raw SQL built from strings
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]",
          message:
            "Unsafe raw SQL is banned (core-rules #18). Use Prisma queries or tagged $queryRaw.",
        },
      ],
    },
  },

  // Default for all source files: no Prisma, no repositories, modules only through index.js.
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictImports(
        prismaBan,
        anyRepositoryBan,
        moduleDeepImportBan
      ),
    },
  },

  // Inside a module: its service and index.ts may use its own repository.
  // Other modules are reached only through their index.js.
  {
    files: ["src/modules/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictImports(
        prismaBan,
        otherModuleDeepImportBan
      ),
    },
  },

  // Controllers, routes and schemas: no Prisma and no repository at all.
  {
    files: [
      "src/modules/**/*.controller.ts",
      "src/modules/**/*.routes.ts",
      "src/modules/**/*.schema.ts",
    ],
    rules: {
      "no-restricted-imports": restrictImports(
        prismaBan,
        anyRepositoryBan,
        otherModuleDeepImportBan
      ),
    },
  },

  // Repositories: the only place Prisma is allowed.
  {
    files: ["src/modules/**/*.repository.ts"],
    rules: {
      "no-restricted-imports": restrictImports(otherModuleDeepImportBan),
    },
  },

  // Wiring files that need the Prisma client or its types. Modules still only via index.js.
  {
    files: ["src/container.ts", "src/types/module.types.ts"],
    rules: {
      "no-restricted-imports": restrictImports(moduleDeepImportBan),
    },
  },

  // Infrastructure files that must touch Prisma directly.
  {
    files: [
      "src/config/prisma.ts",
      "src/utils/errorHandler.ts",
      "prisma/**/*.ts",
      "tests/**/*.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },

  // supertest types response bodies as `any`, so reading them in tests is unavoidable.
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },

  // The only files allowed to read process.env.
  {
    files: [
      "src/config/env.ts",
      "prisma.config.ts",
      // Passes the parent environment (PATH etc.) to the Prisma CLI it spawns.
      "tests/setup/global-setup.ts",
    ],
    rules: { "no-restricted-properties": "off" },
  },

  // Plain JS config files are not part of the TypeScript project.
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  }
);

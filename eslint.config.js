// ESLint guardrails. The import bans below enforce docs/RULES.md rules 2, 5, 6, 18 and 22.
import tseslint from "typescript-eslint";

// --- import bans ------------------------------------------------------------

const prismaBan = {
  group: ["@prisma/client", "**/generated/prisma/**", "**/config/prisma.js"],
  message:
    "Only *.repository.ts files may use Prisma (RULES.md #5). Call a service or repository instead.",
};

const otherModuleRepositoryBan = {
  group: ["../*/*.repository.js", "**/modules/**/*.repository.js"],
  message:
    "Do not import another module's repository (RULES.md #6). Call that module's service.",
};

const anyRepositoryBan = {
  group: ["*.repository.js", "**/*.repository.js"],
  message:
    "Only a service may use a repository (RULES.md #5). Call the service instead.",
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

      // RULES.md #2: env is read only in src/config/env.ts
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read env only through `env` from src/config/env.ts (RULES.md #2).",
        },
      ],

      // RULES.md #18: no raw SQL built from strings
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]",
          message:
            "Unsafe raw SQL is banned (RULES.md #18). Use Prisma queries or tagged $queryRaw.",
        },
      ],
    },
  },

  // Default for all source files: no Prisma, no repositories.
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictImports(prismaBan, anyRepositoryBan),
    },
  },

  // Inside a module: a service may use its own repository, never another module's.
  {
    files: ["src/modules/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictImports(
        prismaBan,
        otherModuleRepositoryBan
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
      "no-restricted-imports": restrictImports(prismaBan, anyRepositoryBan),
    },
  },

  // Repositories: the only place Prisma is allowed.
  {
    files: ["src/modules/**/*.repository.ts"],
    rules: {
      "no-restricted-imports": restrictImports(otherModuleRepositoryBan),
    },
  },

  // Wiring and infrastructure files that must touch Prisma or repositories.
  {
    files: [
      "src/container.ts",
      "src/config/prisma.ts",
      "src/utils/errorHandler.ts",
      "prisma/**/*.ts",
      "tests/**/*.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },

  // The only files allowed to read process.env.
  {
    files: ["src/config/env.ts", "prisma.config.ts"],
    rules: { "no-restricted-properties": "off" },
  },

  // Plain JS config files are not part of the TypeScript project.
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  }
);

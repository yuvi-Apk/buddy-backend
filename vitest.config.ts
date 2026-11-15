import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests always run with .env.test, never with the developer's .env.
    env: parseEnv(readFileSync(".env.test", "utf8")),
    // Integration tests share one Postgres and one Redis, so files run one at a time.
    globalSetup: ["tests/setup/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

// Runs once before the whole test run: applies migrations to the test database.
// Needs `docker compose up -d`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";

export default function setup(): void {
  const testEnv = parseEnv(readFileSync(".env.test", "utf8"));
  const prismaCli = createRequire(import.meta.url).resolve(
    "prisma/build/index.js"
  );

  try {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      env: { ...process.env, ...testEnv },
      stdio: "pipe",
    });
  } catch (err) {
    const output = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(
      `Could not migrate the test database. Is "docker compose up -d" running?\n${output}`,
      { cause: err }
    );
  }
}

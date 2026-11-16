// core-rules #2: .env.sample and .env.test must list exactly the variables in the Zod schema,
// so the sample can never go stale.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { envSchema, loadEnv } from "../../src/config/env.js";

const schemaKeys = Object.keys(envSchema.shape).sort();
const keysOf = (file: string) =>
  Object.keys(parseEnv(readFileSync(file, "utf8"))).sort();

describe("env files", () => {
  it(".env.sample lists exactly the schema variables", () => {
    expect(keysOf(".env.sample")).toEqual(schemaKeys);
  });

  it(".env.test lists exactly the schema variables", () => {
    expect(keysOf(".env.test")).toEqual(schemaKeys);
  });
});

describe("loadEnv", () => {
  const valid = parseEnv(readFileSync(".env.test", "utf8")) as Record<
    string,
    string
  >;

  it("accepts a complete environment", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4001);
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3000"]);
  });

  it("refuses to start when a variable is missing and names it", () => {
    const { DATABASE_URL: _removed, ...incomplete } = valid;
    expect(() => loadEnv(incomplete)).toThrow(/DATABASE_URL/);
  });

  it("refuses a short secret without printing its value", () => {
    const attempt = () =>
      loadEnv({ ...valid, ADMIN_ACCESS_TOKEN_SECRET: "short-secret" });
    expect(attempt).toThrow(/ADMIN_ACCESS_TOKEN_SECRET/);
    expect(attempt).not.toThrow(/short-secret/);
  });

  it("splits GOOGLE_CLIENT_IDS into a list and refuses an empty one", () => {
    expect(loadEnv(valid).GOOGLE_CLIENT_IDS).toEqual([
      "test-web-client.apps.googleusercontent.com",
      "test-android-client.apps.googleusercontent.com",
    ]);
    expect(() => loadEnv({ ...valid, GOOGLE_CLIENT_IDS: " , " })).toThrow(
      /GOOGLE_CLIENT_IDS/
    );
  });
});

import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { logger } from "../../src/config/logger.js";
import { PasswordHasher } from "../../src/core/security/PasswordHasher.js";
import { asyncHandler } from "../../src/utils/asyncHandler.js";
import { errorHandler } from "../../src/utils/errorHandler.js";
import {
  app,
  closeTestApp,
  container,
  prisma,
  redis,
  resetState,
} from "../helpers/testApp.js";

beforeEach(resetState);
afterAll(closeTestApp);

describe("readiness check", () => {
  it("reports Postgres and Redis as up", async () => {
    const res = await request(app).get("/api/v1/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      checks: { postgres: "up", redis: "up" },
    });
  });

  it("returns 503 without details when a dependency is down", async () => {
    const brokenApp = createApp({
      ...container,
      healthChecks: {
        postgres: () =>
          Promise.reject(new Error("password authentication failed")),
      },
    });
    const res = await request(brokenApp).get("/api/v1/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: "unavailable",
      checks: { postgres: "down" },
    });
  });
});

describe("stores", () => {
  it("reads and writes Redis", async () => {
    await redis.set("probe", "1", "EX", 10);
    expect(await redis.get("probe")).toBe("1");
  });

  it("reads and writes Postgres", async () => {
    const role = await prisma.role.create({ data: { name: "EDITOR" } });
    expect(await prisma.role.count()).toBe(1);
    expect(role.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("errorHandler with Prisma errors", () => {
  const errorApp = express();
  errorApp.use(pinoHttp({ logger }));
  errorApp.get(
    "/duplicate",
    asyncHandler(async () => {
      await prisma.role.create({ data: { name: "DUP" } });
      await prisma.role.create({ data: { name: "DUP" } });
    })
  );
  errorApp.get(
    "/missing",
    asyncHandler(async () => {
      await prisma.role.update({
        where: { id: "00000000-0000-0000-0000-000000000000" },
        data: { name: "X" },
      });
    })
  );
  errorApp.use(errorHandler);

  it("maps a unique violation to 409 without Prisma details", async () => {
    const res = await request(errorApp).get("/duplicate");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "A record with this value already exists",
      errors: [],
      data: null,
    });
  });

  it("maps a missing record to 404", async () => {
    const res = await request(errorApp).get("/missing");
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Record not found");
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|Role|P2025/i);
  });
});

describe("PasswordHasher", () => {
  const hasher = new PasswordHasher();

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hasher.hash("correct horse battery");
    expect(hash).not.toContain("correct horse battery");
    expect(await hasher.verify("correct horse battery", hash)).toBe(true);
    expect(await hasher.verify("wrong password", hash)).toBe(false);
  });

  it("salts every hash and never throws on a malformed one", async () => {
    const first = await hasher.hash("same-password-123");
    const second = await hasher.hash("same-password-123");
    expect(first).not.toBe(second);
    expect(await hasher.verify("anything", "not-a-hash")).toBe(false);
    expect(await hasher.verify("anything", "")).toBe(false);
  });
});

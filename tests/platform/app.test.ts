import express from "express";
import jwt from "jsonwebtoken";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/app.js";
import { logger } from "../../src/config/logger.js";
import { createContainer } from "../../src/container.js";
import { ApiError } from "../../src/utils/ApiError.js";
import { asyncHandler } from "../../src/utils/asyncHandler.js";
import { errorHandler } from "../../src/utils/errorHandler.js";

const app = createApp(createContainer());

describe("app shell", () => {
  it("answers the liveness check", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("sets security headers and a request ID, and hides Express", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns the standard error shape for an unknown route", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "Route not found",
      errors: [],
      data: null,
    });
  });

  it("allows a listed CORS origin and ignores an unlisted one", async () => {
    const allowed = await request(app)
      .get("/api/v1/health")
      .set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000"
    );

    const blocked = await request(app)
      .get("/api/v1/health")
      .set("Origin", "https://evil.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects malformed JSON with a safe 400", async () => {
    const res = await request(app)
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid request body");
  });

  it("rejects an oversized body with a safe 413", async () => {
    const res = await request(app)
      .post("/api/v1/health")
      .send({ blob: "x".repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.message).toBe("Request body too large");
  });
});

describe("errorHandler", () => {
  // A tiny app whose routes throw each kind of error.
  const errorApp = express();
  errorApp.use(pinoHttp({ logger }));
  errorApp.get("/api-error", () => {
    throw new ApiError(409, "Email already in use", [{ field: "email" }]);
  });
  errorApp.get("/zod", () => {
    z.object({ name: z.string() }).parse({});
  });
  errorApp.get("/secret", () => {
    throw new Error("connect ECONNREFUSED postgres://buddy:hunter2@db:5432");
  });
  errorApp.get(
    "/async-secret",
    asyncHandler(async () => {
      await Promise.resolve();
      throw new Error("SELECT * FROM admin_user failed");
    })
  );
  errorApp.get("/jwt-expired", () => {
    throw new jwt.TokenExpiredError("jwt expired", new Date());
  });
  errorApp.get("/jwt-invalid", () => {
    throw new jwt.JsonWebTokenError("invalid signature");
  });
  errorApp.use(errorHandler);

  it("passes an ApiError through with its status and message", async () => {
    const res = await request(errorApp).get("/api-error");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "Email already in use",
      errors: [{ field: "email" }],
      data: null,
    });
  });

  it("turns a ZodError into field errors", async () => {
    const res = await request(errorApp).get("/zod");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
    expect(res.body.errors[0].field).toBe("name");
  });

  it("never leaks the message or stack of an unexpected error", async () => {
    for (const path of ["/secret", "/async-secret"]) {
      const res = await request(errorApp).get(path);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        message: "Internal Server Error",
        errors: [],
        data: null,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|SELECT|stack/);
    }
  });

  it("reports an expired token separately from an invalid one", async () => {
    const expired = await request(errorApp).get("/jwt-expired");
    expect(expired.status).toBe(401);
    expect(expired.body.message).toBe("Token expired");

    const invalid = await request(errorApp).get("/jwt-invalid");
    expect(invalid.status).toBe(401);
    expect(invalid.body.message).toBe("Invalid token");
  });
});

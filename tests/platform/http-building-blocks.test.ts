import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { logger } from "../../src/config/logger.js";
import { createRateLimiter } from "../../src/middlewares/rateLimit.middleware.js";
import { validate } from "../../src/middlewares/validate.middleware.js";
import { errorHandler } from "../../src/utils/errorHandler.js";
import {
  MAX_PAGE_SIZE,
  paginated,
  paginationQuery,
  toSkipTake,
} from "../../src/utils/pagination.js";
import { closeTestApp, redis, resetState } from "../helpers/testApp.js";

beforeEach(resetState);
afterAll(closeTestApp);

describe("validate()", () => {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.post(
    "/items/:id",
    validate({
      params: z.strictObject({ id: z.uuid() }),
      query: paginationQuery,
      body: z.strictObject({ name: z.string().min(2) }),
    }),
    (req, res) => {
      res.json(req.validated);
    }
  );
  app.use(errorHandler);

  const id = "3f2b8c1e-6d4a-4e9b-9c1f-2a7d5e8b0c11";

  it("passes parsed and coerced input to the handler", async () => {
    const res = await request(app)
      .post(`/items/${id}?page=2&limit=5`)
      .send({ name: "Maths" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      params: { id },
      query: { page: 2, limit: 5 },
      body: { name: "Maths" },
    });
  });

  it("rejects unknown keys instead of dropping them", async () => {
    const res = await request(app)
      .post(`/items/${id}`)
      .send({ name: "Maths", isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
  });

  it("returns field errors for bad body, params and query", async () => {
    const badBody = await request(app).post(`/items/${id}`).send({ name: "x" });
    expect(badBody.status).toBe(400);
    expect(badBody.body.errors[0].field).toBe("name");

    const badParams = await request(app)
      .post("/items/not-a-uuid")
      .send({ name: "Maths" });
    expect(badParams.status).toBe(400);

    const tooBig = await request(app)
      .post(`/items/${id}?limit=${MAX_PAGE_SIZE + 1}`)
      .send({ name: "Maths" });
    expect(tooBig.status).toBe(400);
  });

  it("treats a missing body as empty and reports the missing field", async () => {
    const res = await request(app).post(`/items/${id}`);
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe("name");
  });
});

describe("pagination helpers", () => {
  it("applies defaults and converts to skip/take", () => {
    const query = paginationQuery.parse({});
    expect(query).toEqual({ page: 1, limit: 20 });
    expect(toSkipTake({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10 });
  });

  it("builds the page metadata", () => {
    expect(paginated(["a", "b"], 41, { page: 1, limit: 20 })).toEqual({
      items: ["a", "b"],
      meta: { page: 1, limit: 20, total: 41, totalPages: 3 },
    });
  });
});

describe("rate limiter", () => {
  it("returns 429 in the standard error shape once the limit is passed", async () => {
    const app = express();
    app.use(
      createRateLimiter(redis, { name: "test", windowSeconds: 60, limit: 3 })
    );
    app.get("/", (_req, res) => {
      res.json({ ok: true });
    });

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get("/")).status).toBe(200);
    }
    const blocked = await request(app).get("/");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      success: false,
      message: "Too many requests, try again later",
      errors: [],
      data: null,
    });
  });

  it("stores its counters in Redis, shared across instances", async () => {
    const build = () => {
      const app = express();
      app.use(
        createRateLimiter(redis, {
          name: "shared",
          windowSeconds: 60,
          limit: 1,
        })
      );
      app.get("/", (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    };

    expect((await request(build()).get("/")).status).toBe(200);
    // A second, separate app instance sees the count from the first.
    expect((await request(build()).get("/")).status).toBe(429);
    expect((await redis.keys("rate-limit:shared:*")).length).toBe(1);
  });
});

// core-rules #11: secrets never appear in logs.
import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loggerOptions } from "../../src/config/logger.js";

/** A logger with the app's real options that writes into a string instead of stdout. */
function captureLogger() {
  let output = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  const logger = pino({ ...loggerOptions, level: "info" }, stream);
  return { logger, read: () => output };
}

describe("log redaction", () => {
  it("redacts secret fields at the top level and one level down", () => {
    const { logger, read } = captureLogger();
    logger.info(
      {
        password: "hunter2-password",
        otp: "123456",
        token: "tok-abc",
        user: { password: "nested-password", refreshToken: "ref-xyz" },
        body: { accessToken: "acc-123", otp: "654321" },
        email: "visible@buddy.test",
      },
      "login attempt"
    );

    const logged = read();
    for (const secret of [
      "hunter2-password",
      "123456",
      "tok-abc",
      "nested-password",
      "ref-xyz",
      "acc-123",
      "654321",
    ]) {
      expect(logged, secret).not.toContain(secret);
    }
    expect(logged).toContain("[REDACTED]");
    expect(logged).toContain("visible@buddy.test");
  });

  it("keeps tokens and cookies out of the request log", async () => {
    const { logger, read } = captureLogger();
    const app = express();
    app.use(pinoHttp({ logger }));
    app.get("/", (_req, res) => {
      res.cookie("refreshToken", "set-cookie-secret").json({ ok: true });
    });

    await request(app)
      .get("/")
      .set("Authorization", "Bearer header-secret-token")
      .set("Cookie", "accessToken=cookie-secret-token");

    const logged = read();
    expect(logged).toContain("request completed");
    expect(logged).not.toContain("header-secret-token");
    expect(logged).not.toContain("cookie-secret-token");
    expect(logged).not.toContain("set-cookie-secret");
  });
});

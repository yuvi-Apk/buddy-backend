// Central error handler. Every error ends here and leaves as { success, message, errors, data }.
// core-rules #10: the client only ever sees a safe, fixed message. The real error goes to the log.
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { ApiError } from "./ApiError.js";

interface ErrorBody {
  success: false;
  message: string;
  errors: unknown[];
  data: null;
}

const body = (message: string, errors: unknown[] = []): ErrorBody => ({
  success: false,
  message,
  errors,
  data: null,
});

const PRISMA_ERRORS: Record<string, { status: number; message: string }> = {
  P2002: { status: 409, message: "A record with this value already exists" },
  P2003: {
    status: 409,
    message: "This record is linked to other records and cannot be changed",
  },
  P2025: { status: 404, message: "Record not found" },
};

// Errors raised by Express body parsers and similar middleware carry a 4xx status.
const SAFE_CLIENT_MESSAGES: Record<number, string> = {
  400: "Invalid request body",
  413: "Request body too large",
  415: "Unsupported content type",
};

function clientErrorStatus(err: Error): number | undefined {
  const status =
    (err as { status?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : undefined;
}

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // If the response has already started, let Express close the connection.
  if (res.headersSent) {
    return next(err);
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json(
      body(
        "Validation failed",
        err.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }))
      )
    );
  }

  // Our own ApiErrors
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      req.log.error({ err }, "ApiError with 5xx status");
    }
    return res.status(err.statusCode).json(body(err.message, err.errors));
  }

  // Prisma errors: fixed messages only, the raw error names tables and columns
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = PRISMA_ERRORS[err.code];
    if (mapped) {
      return res.status(mapped.status).json(body(mapped.message));
    }
    req.log.error({ err }, "Unmapped Prisma error");
    return res.status(500).json(body("Internal Server Error"));
  }

  // Upload errors
  if (err instanceof MulterError) {
    return err.code === "LIMIT_FILE_SIZE"
      ? res.status(413).json(body("File is too large"))
      : res.status(400).json(body("Invalid file upload"));
  }

  // JWT errors: TokenExpiredError extends JsonWebTokenError, so check it first
  if (err instanceof jwt.TokenExpiredError) {
    return res.status(401).json(body("Token expired"));
  }
  if (err instanceof jwt.JsonWebTokenError) {
    return res.status(401).json(body("Invalid token"));
  }

  // Body parser and other 4xx middleware errors
  if (err instanceof Error) {
    const status = clientErrorStatus(err);
    if (status !== undefined) {
      return res
        .status(status)
        .json(body(SAFE_CLIENT_MESSAGES[status] ?? "Request failed"));
    }
  }

  // Anything else: log the real error, tell the client nothing
  req.log.error({ err }, "Unhandled error");
  return res.status(500).json(body("Internal Server Error"));
};

// Throw this for every expected failure. errorHandler turns it into the JSON response.
// The message is sent to the client, so never put internal details in it.
export class ApiError extends Error {
  statusCode: number;
  data: null;
  success: boolean;
  errors: unknown[];

  constructor(
    statusCode: number,
    message: string,
    errors: unknown[] = [],
    stack?: string
  ) {
    super(message);

    this.statusCode = statusCode;
    this.data = null;
    this.success = false;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  static badRequest(message = "Bad request", errors: unknown[] = []) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, message);
  }

  static forbidden(message = "Forbidden") {
    return new ApiError(403, message);
  }

  static notFound(message = "Not found") {
    return new ApiError(404, message);
  }

  static conflict(message = "Conflict") {
    return new ApiError(409, message);
  }

  static tooManyRequests(message = "Too many requests, try again later") {
    return new ApiError(429, message);
  }
}

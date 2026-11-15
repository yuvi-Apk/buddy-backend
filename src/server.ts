// Process entry point: start the HTTP server and shut it down cleanly.
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createContainer } from "./container.js";

const container = createContainer();
const app = createApp(container);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Buddy API listening");
});

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  // Stop accepting new connections, let running requests finish, then close stores.
  server.close(() => {
    container
      .shutdown()
      .catch((err: unknown) => logger.error({ err }, "Error during shutdown"))
      .finally(() => process.exit(0));
  });

  // Safety net: never hang forever on a stuck connection.
  setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  shutdown("uncaughtException");
});

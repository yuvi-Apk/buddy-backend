// Composition root: the only file that constructs classes and wires them together.
// Order inside createContainer: infrastructure → repositories → services → controllers.
import type { HealthCheck } from "./core/health/health.routes.js";

export interface Container {
  healthChecks: Record<string, HealthCheck>;
  /** Closes database and cache connections. Called on shutdown and after tests. */
  shutdown: () => Promise<void>;
}

export function createContainer(): Container {
  return {
    healthChecks: {},
    shutdown: async () => {},
  };
}

import { Router } from "express";
import { publicRoute } from "../../middlewares/routeGuard.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

// A check resolves when the dependency is reachable and rejects when it is not.
export type HealthCheck = () => Promise<void>;

export function createHealthRouter(
  checks: Record<string, HealthCheck>
): Router {
  const router = Router();

  // Liveness: the process is up.
  router.get("/", publicRoute(), (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Readiness: the process can reach everything it depends on.
  router.get(
    "/ready",
    publicRoute(),
    asyncHandler(async (req, res) => {
      const names = Object.keys(checks);
      const results = await Promise.allSettled(
        names.map((name) => checks[name]!())
      );

      const report: Record<string, "up" | "down"> = {};
      results.forEach((result, index) => {
        const name = names[index]!;
        report[name] = result.status === "fulfilled" ? "up" : "down";
        if (result.status === "rejected") {
          req.log.error(
            { err: result.reason, check: name },
            "Health check failed"
          );
        }
      });

      const ready = results.every((result) => result.status === "fulfilled");
      // Only up/down is returned; failure details stay in the log.
      res
        .status(ready ? 200 : 503)
        .json({ status: ready ? "ok" : "unavailable", checks: report });
    })
  );

  return router;
}

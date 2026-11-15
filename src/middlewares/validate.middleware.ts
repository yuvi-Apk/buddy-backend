// RULES.md #7: every route validates its input with Zod before the controller runs.
//
//   router.post("/", verifyAdmin, validate({ body: createRoleSchema }), controller.create);
//
// In the controller:
//   const input = req.validated.body as CreateRoleInput;
//
// Write schemas with z.strictObject(...) so unknown keys are rejected, not silently dropped.
import type { RequestHandler } from "express";
import type { ZodType } from "zod";

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    // A ZodError thrown here is turned into a 400 with field errors by errorHandler.
    req.validated = {
      body: schemas.body ? schemas.body.parse(req.body ?? {}) : undefined,
      query: schemas.query ? schemas.query.parse(req.query) : undefined,
      params: schemas.params ? schemas.params.parse(req.params) : undefined,
    };
    next();
  };

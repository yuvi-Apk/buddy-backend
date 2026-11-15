import type { Request, Response } from "express";

// Reached when no route matched. Kept generic so it does not reveal which routes exist.
export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    errors: [],
    data: null,
  });
};

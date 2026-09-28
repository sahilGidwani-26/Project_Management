import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError";
import { ZodError } from "zod";
import mongoose from "mongoose";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found`, code: "ROUTE_NOT_FOUND" });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      code: "VALIDATION_ERROR",
      details: err.flatten(),
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
      details: err.details,
    });
  }

  // A malformed id (e.g. an empty/invalid string reaching a query filter or
  // route param) should be a clean 400, not a noisy 500 + stack trace.
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      message: `Invalid value for "${err.path}"`,
      code: "INVALID_ID",
    });
  }

  const anyErr = err as { code?: number; message?: string };
  if (anyErr?.code === 11000) {
    return res.status(409).json({ success: false, message: "Duplicate resource", code: "DUPLICATE_KEY" });
  }

  console.error("[unhandled error]", err);
  return res.status(500).json({ success: false, message: "Internal server error", code: "INTERNAL_ERROR" });
}
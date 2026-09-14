import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../domain/errors.js";
import { logger } from "../logger.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "Request body failed validation.",
        details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  // Anything reaching here is unclassified, so the cause is logged but never returned.
  // At `pre-revamp` every failure collapsed into the same opaque 500 (server.js:46, :61,
  // :81, :99, :114) and the real reason was lost entirely.
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error." } });
};

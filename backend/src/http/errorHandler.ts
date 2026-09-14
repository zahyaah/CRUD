import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../domain/errors.js";
import { logger } from "../logger.js";

interface BodyParserError extends Error {
  status: number;
  type: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    err instanceof Error &&
    "type" in err &&
    typeof (err as { type: unknown }).type === "string" &&
    (err as { type: string }).type.startsWith("entity.")
  );
}

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

  // body-parser rejections carry `type` and a status. Without this they reach the catch-all
  // below, so a malformed body or an oversized payload is logged as an unhandled server fault
  // and answered with 500 rather than 400 or 413.
  if (err instanceof SyntaxError || isBodyParserError(err)) {
    const status = isBodyParserError(err) ? err.status : 400;
    res.status(status).json({
      error: {
        code: status === 413 ? "PAYLOAD_TOO_LARGE" : "MALFORMED_BODY",
        message:
          status === 413
            ? "Request body exceeds the 1mb limit."
            : "Request body is not valid JSON.",
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

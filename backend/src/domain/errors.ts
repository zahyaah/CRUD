export type ErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "COALESCE_TIMEOUT"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(id: number) {
    super("NOT_FOUND", 404, `Product ${id} does not exist.`);
  }
}

/**
 * Carries the current version so the client can re-read, rebase its edit and retry without
 * a second round trip to discover what it collided with.
 */
export class VersionConflictError extends AppError {
  constructor(id: number, expectedVersion: number, actualVersion: number) {
    super(
      "VERSION_CONFLICT",
      409,
      `Product ${id} was modified by another request. Expected version ${expectedVersion}, current version is ${actualVersion}.`,
      { expectedVersion, actualVersion },
    );
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super(
      "IDEMPOTENCY_KEY_REUSED",
      422,
      "This Idempotency-Key was already used with a different request body.",
    );
  }
}

/**
 * A waiter gave up before the leader reached a terminal state. 504 rather than 409: the
 * request is still legitimately in progress somewhere, so the client should retry the same
 * key rather than treat this as a conflict to resolve.
 */
export class CoalesceTimeoutError extends AppError {
  constructor(waitedMs: number) {
    super(
      "COALESCE_TIMEOUT",
      504,
      `Timed out after ${waitedMs}ms waiting for an in-flight request with this Idempotency-Key. Retry with the same key.`,
    );
  }
}

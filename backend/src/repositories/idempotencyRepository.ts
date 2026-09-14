import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isDuplicateEntry, type Queryable } from "../db/pool.js";

export interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  state: "processing" | "completed" | "failed";
  responseStatus: number | null;
  responseBody: unknown;
  errorMessage: string | null;
  resourceId: number | null;
  leaderToken: string;
}

interface IdempotencyRow extends RowDataPacket {
  idempotency_key: string;
  request_fingerprint: string;
  state: "processing" | "completed" | "failed";
  response_status: number | null;
  response_body: unknown;
  error_message: string | null;
  resource_id: number | null;
  leader_token: string;
}

// MySQL has no millisecond INTERVAL unit, so leases are expressed in microseconds.
const MICROS_PER_MS = 1000;

/**
 * Attempts to become the leader for a key.
 *
 * The INSERT is the entire mutual-exclusion mechanism: the PRIMARY KEY means exactly one
 * concurrent caller can succeed, and the database — not the application — is the arbiter.
 * Everyone else becomes a waiter.
 */
export async function claimLeadership(
  db: Queryable,
  key: string,
  fingerprint: string,
  leaderToken: string,
  leaseMs: number,
  ttlHours: number,
): Promise<"leader" | "taken"> {
  try {
    await db.execute<ResultSetHeader>(
      `INSERT INTO idempotency_key
         (idempotency_key, request_fingerprint, state, leader_token, lease_expires_at, expires_at)
       VALUES (?, ?, 'processing', ?, DATE_ADD(NOW(3), INTERVAL ? MICROSECOND),
               DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [key, fingerprint, leaderToken, leaseMs * MICROS_PER_MS, ttlHours],
    );
    return "leader";
  } catch (error) {
    if (isDuplicateEntry(error)) {
      return "taken";
    }
    throw error;
  }
}

export async function find(db: Queryable, key: string): Promise<IdempotencyRecord | null> {
  const [rows] = await db.query<IdempotencyRow[]>(
    `SELECT idempotency_key, request_fingerprint, state, response_status, response_body,
            error_message, resource_id, leader_token
       FROM idempotency_key
      WHERE idempotency_key = ?`,
    [key],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    key: row.idempotency_key,
    fingerprint: row.request_fingerprint,
    state: row.state,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    errorMessage: row.error_message,
    resourceId: row.resource_id,
    leaderToken: row.leader_token,
  };
}

/**
 * Takes over a key whose leader stopped renewing — a crashed or hung process.
 *
 * The lease check lives in the WHERE clause so the read and the takeover are one atomic
 * statement; two waiters racing to steal cannot both see an expired lease and both win.
 * Returns whether this caller is now the leader.
 */
export async function stealLeadership(
  db: Queryable,
  key: string,
  leaderToken: string,
  leaseMs: number,
): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE idempotency_key
        SET leader_token = ?, lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? MICROSECOND)
      WHERE idempotency_key = ?
        AND state = 'processing'
        AND lease_expires_at < NOW(3)`,
    [leaderToken, leaseMs * MICROS_PER_MS, key],
  );
  return result.affectedRows === 1;
}

/**
 * Takes over a key whose previous attempt failed, so the same key can be retried later.
 *
 * Without this a single transient failure would burn the key forever and every subsequent
 * retry — the exact thing idempotency keys exist to make safe — would replay the failure.
 * Only attempted once, before waiting begins, so a waiter already blocked on a leader that
 * then fails still receives that failure rather than silently re-running the work.
 */
export async function reclaimFailed(
  db: Queryable,
  key: string,
  fingerprint: string,
  leaderToken: string,
  leaseMs: number,
): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE idempotency_key
        SET state = 'processing', leader_token = ?, request_fingerprint = ?,
            lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? MICROSECOND),
            error_message = NULL, completed_at = NULL
      WHERE idempotency_key = ? AND state = 'failed'`,
    [leaderToken, fingerprint, leaseMs * MICROS_PER_MS, key],
  );
  return result.affectedRows === 1;
}

/**
 * Records a terminal outcome, but only while this caller still owns the lease. A leader that
 * stalled past its lease and then revived would otherwise overwrite the result of the waiter
 * that legitimately took the work over.
 */
export async function settle(
  db: Queryable,
  key: string,
  leaderToken: string,
  outcome:
    | { state: "completed"; status: number; body: unknown; resourceId: number | null }
    | { state: "failed"; errorMessage: string },
): Promise<boolean> {
  const [result] =
    outcome.state === "completed"
      ? await db.execute<ResultSetHeader>(
          `UPDATE idempotency_key
              SET state = 'completed', response_status = ?, response_body = ?,
                  resource_id = ?, completed_at = NOW(3)
            WHERE idempotency_key = ? AND leader_token = ?`,
          [outcome.status, JSON.stringify(outcome.body), outcome.resourceId, key, leaderToken],
        )
      : await db.execute<ResultSetHeader>(
          `UPDATE idempotency_key
              SET state = 'failed', error_message = ?, completed_at = NOW(3)
            WHERE idempotency_key = ? AND leader_token = ?`,
          [outcome.errorMessage.slice(0, 1024), key, leaderToken],
        );

  return result.affectedRows === 1;
}

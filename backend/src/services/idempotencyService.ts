import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { PoolConnection } from "mysql2/promise";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { CoalesceTimeoutError, IdempotencyKeyReusedError } from "../domain/errors.js";
import { logger } from "../logger.js";
import { increment } from "../metrics.js";
import * as keys from "../repositories/idempotencyRepository.js";

export interface Executed {
  status: number;
  body: unknown;
  resourceId: number | null;
}

/**
 * Receives the leader's transaction. The operation's writes must go through it, or the
 * fencing check in `runAsLeader` cannot roll them back.
 */
export type IdempotentOperation = (tx: PoolConnection) => Promise<Executed>;

export type IdempotentResult = Executed & { coalesced: boolean };

/** A leader that lost its lease mid-flight; its work has been rolled back. */
const LOST_LEASE = Symbol("lost-lease");

/**
 * Stable fingerprint of a request body. Object keys are sorted so that two semantically
 * identical bodies serialised in a different order still compare equal — otherwise a
 * legitimate retry from a client that reorders its JSON would be misread as key reuse.
 */
function fingerprint(body: unknown): string {
  const canonical = JSON.stringify(body, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  });
  return createHash("sha256").update(canonical ?? "null").digest("hex");
}

/** Jittered so a burst of waiters on one key does not poll in lockstep. */
function nextPollDelayMs(): number {
  const spread = env.IDEMPOTENCY_POLL_INTERVAL_MS * env.IDEMPOTENCY_POLL_JITTER_RATIO;
  return env.IDEMPOTENCY_POLL_INTERVAL_MS + (Math.random() * 2 - 1) * spread;
}

/**
 * Runs the operation and records its outcome in one transaction.
 *
 * The ownership re-check has to commit atomically with the operation's writes. A lease can
 * only tell you that a leader stopped *renewing*, never that it stopped *working* — so a
 * merely slow leader can have its key stolen while its insert is still in flight. Fencing
 * the settle alone is not enough: it stops a stale leader recording a result but not from
 * committing its row. Load testing that version produced 28 duplicate products across 28
 * steals, which is what moved the operation inside this transaction.
 */
async function runAsLeader(
  key: string,
  token: string,
  operation: IdempotentOperation,
  coalesced: boolean,
): Promise<IdempotentResult | typeof LOST_LEASE> {
  increment("leaderRequests");
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let result: Executed;
    try {
      result = await operation(connection);
    } catch (error) {
      await connection.rollback();
      increment("leaderFailures");
      await keys.settle(pool, key, token, {
        state: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const stillLeader = await keys.settle(connection, key, token, {
      state: "completed",
      status: result.status,
      body: result.body,
      resourceId: result.resourceId,
    });

    if (!stillLeader) {
      await connection.rollback();
      increment("fencedRollbacks");
      logger.warn({ key }, "lease lost mid-flight, work rolled back");
      return LOST_LEASE;
    }

    await connection.commit();
    return { ...result, coalesced };
  } finally {
    connection.release();
  }
}

async function awaitOutcome(
  key: string,
  requestFingerprint: string,
  operation: IdempotentOperation,
): Promise<IdempotentResult> {
  increment("waiterRequests");
  const startedAt = Date.now();

  try {
    for (;;) {
      const record = await keys.find(pool, key);

      if (!record) {
        // Retention cleanup removed the row mid-wait. Racing to re-claim is the only way
        // forward; losing that race simply means someone else is now the leader.
        const token = randomUUID();
        const retry = await keys.claimLeadership(
          pool,
          key,
          requestFingerprint,
          token,
          env.IDEMPOTENCY_LEASE_MS,
          env.IDEMPOTENCY_TTL_HOURS,
        );
        if (retry === "leader") {
          const result = await runAsLeader(key, token, operation, true);
          if (result !== LOST_LEASE) return result;
        }
      } else if (record.fingerprint !== requestFingerprint) {
        increment("fingerprintMismatches");
        throw new IdempotencyKeyReusedError();
      } else if (record.state === "completed") {
        return {
          status: record.responseStatus ?? 200,
          body: record.responseBody,
          resourceId: record.resourceId,
          coalesced: true,
        };
      } else if (record.state === "failed") {
        // Surface the leader's failure rather than making every waiter burn the full
        // budget. The message is logged, never returned, so a waiter's client sees exactly
        // the generic 500 the leader's client saw.
        logger.warn({ key, error: record.errorMessage }, "waiter observed leader failure");
        throw new Error(record.errorMessage ?? "Leader request failed.");
      } else {
        const token = randomUUID();
        if (await keys.stealLeadership(pool, key, token, env.IDEMPOTENCY_LEASE_MS)) {
          increment("lockSteals");
          logger.warn({ key }, "lease expired, waiter took over");
          const result = await runAsLeader(key, token, operation, true);
          if (result !== LOST_LEASE) return result;
        }
      }

      if (Date.now() - startedAt >= env.IDEMPOTENCY_MAX_WAIT_MS) {
        increment("waiterTimeouts");
        throw new CoalesceTimeoutError(Date.now() - startedAt);
      }

      await sleep(nextPollDelayMs());
    }
  } finally {
    increment("waiterWaitMsTotal", Date.now() - startedAt);
  }
}

/**
 * Runs `operation` at most once per idempotency key, coalescing concurrent duplicates onto
 * the single in-flight execution rather than rejecting them.
 *
 * The first caller to insert the key is the leader and does the work. Everyone else polls
 * the same row and returns whatever the leader recorded, so every caller gets an ordinary
 * response and no client needs conflict-handling logic.
 */
export async function runIdempotent(
  key: string,
  requestBody: unknown,
  operation: IdempotentOperation,
): Promise<IdempotentResult> {
  const requestFingerprint = fingerprint(requestBody);
  const token = randomUUID();

  const role = await keys.claimLeadership(
    pool,
    key,
    requestFingerprint,
    token,
    env.IDEMPOTENCY_LEASE_MS,
    env.IDEMPOTENCY_TTL_HOURS,
  );

  if (role === "leader") {
    const result = await runAsLeader(key, token, operation, false);
    if (result !== LOST_LEASE) return result;
  } else if (
    // A previous attempt on this key failed. Exactly one of a racing set wins the takeover
    // and re-runs it; the rest fall through to waiting.
    await keys.reclaimFailed(pool, key, requestFingerprint, token, env.IDEMPOTENCY_LEASE_MS)
  ) {
    const result = await runAsLeader(key, token, operation, false);
    if (result !== LOST_LEASE) return result;
  }

  return awaitOutcome(key, requestFingerprint, operation);
}

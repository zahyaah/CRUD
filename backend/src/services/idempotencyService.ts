import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { PoolConnection } from "mysql2/promise";
import { env } from "../config/env.js";
import { leasePool, pool } from "../db/pool.js";
import { AppError, CoalesceTimeoutError, IdempotencyKeyReusedError } from "../domain/errors.js";
import { logger } from "../logger.js";
import { increment } from "../metrics.js";
import * as keys from "../repositories/idempotencyRepository.js";

export interface Executed {
  status: number;
  body: unknown;
  resourceId: number | null;
}

/**
 * Receives the leader's transaction.
 *
 * At-most-once holds only for work done through this handle. A side effect outside it (a
 * write on the pool, an email, a payment call) runs again whenever a lease is stolen or a
 * failed key is reclaimed, because only the transaction can be rolled back.
 */
export type IdempotentOperation = (tx: PoolConnection) => Promise<Executed>;

export type IdempotentResult = Executed & { coalesced: boolean };

/** A leader that lost its lease mid-flight; its work has been rolled back. */
const LOST_LEASE = Symbol("lost-lease");

/**
 * Stable fingerprint of a request body. Object keys are sorted so that two semantically
 * identical bodies serialised in a different order still compare equal. Otherwise a
 * legitimate retry from a client that reorders its JSON would be misread as key reuse.
 *
 * The comparison is by code unit, not `localeCompare`: locale-aware ordering varies with the
 * ICU data a process was built against, so two API instances could hash the same body
 * differently and reject each other's retries.
 */
export function fingerprint(body: unknown): string {
  const canonical = JSON.stringify(body, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
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
 * only tell you that a leader stopped *renewing*, never that it stopped *working*, so a
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
  const connection = await pool.getConnection();

  // Renewals run on leasePool, never on `pool` or on `connection`. Not `connection`, because a
  // renewal inside the uncommitted transaction is invisible to every other process, which is
  // the one thing it exists to avoid. Not `pool`, because this leader is holding one of its
  // connections and would queue behind itself.
  //
  // The lease was taken before this connection was acquired, and under a burst that wait can
  // consume most of it, so restart the clock now that the work can actually begin.
  await keys.renewLease(leasePool, key, token, env.IDEMPOTENCY_LEASE_MS);

  const heartbeat = setInterval(() => {
    void keys.renewLease(leasePool, key, token, env.IDEMPOTENCY_LEASE_MS).catch(() => undefined);
  }, Math.max(1, Math.floor(env.IDEMPOTENCY_LEASE_MS / 3)));

  try {
    await connection.beginTransaction();

    let result: Executed;
    try {
      result = await operation(connection);
    } catch (error) {
      await connection.rollback();
      increment("leaderFailures");
      await keys.settle(leasePool, key, token, {
        state: "failed",
        status: error instanceof AppError ? error.status : 500,
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
    increment("leaderExecutions");
    return { ...result, coalesced };
  } finally {
    clearInterval(heartbeat);
    connection.release();
  }
}

async function awaitOutcome(
  key: string,
  requestFingerprint: string,
  operation: IdempotentOperation,
): Promise<IdempotentResult> {
  increment("waiterCount");
  const startedAt = Date.now();

  try {
    for (;;) {
      const record = await keys.find(pool, key);

      if (!record) {
        // Retention cleanup removed the row mid-wait. No reaper runs today, so this is
        // unreachable; it exists so that adding one cannot turn into a silent re-execution.
        const reclaimToken = randomUUID();
        const retry = await keys.claimLeadership(
          pool,
          key,
          requestFingerprint,
          reclaimToken,
          env.IDEMPOTENCY_LEASE_MS,
          env.IDEMPOTENCY_TTL_HOURS,
        );
        if (retry === "leader") {
          // This caller performs the work, so it is not a coalesced response.
          const result = await runAsLeader(key, reclaimToken, operation, false);
          if (result !== LOST_LEASE) return result;
        }
      } else if (record.fingerprint !== requestFingerprint) {
        increment("fingerprintMismatches");
        throw new IdempotencyKeyReusedError();
      } else if (record.state === "completed") {
        increment("coalescedResponses");
        return {
          status: record.responseStatus ?? 200,
          body: record.responseBody,
          resourceId: record.resourceId,
          coalesced: true,
        };
      } else if (record.state === "failed") {
        // Surface the leader's failure rather than making every waiter burn the full
        // budget, reproducing the status the leader's own client received. The recorded
        // message is logged and never returned, so a waiter learns no more than the leader did.
        logger.warn({ key, error: record.errorMessage }, "waiter observed leader failure");
        const status = record.responseStatus ?? 500;
        if (status === 500) throw new Error(record.errorMessage ?? "Leader request failed.");
        throw new AppError("INTERNAL", status, "The original request for this key failed.");
      } else {
        const stealToken = randomUUID();
        if (await keys.stealLeadership(pool, key, stealToken, env.IDEMPOTENCY_LEASE_MS)) {
          increment("lockSteals");
          logger.warn({ key }, "lease expired, waiter took over");
          // Took the work over and ran it, so this response is not coalesced. Reporting it as
          // coalesced left a steal with no caller claiming the execution, which made the
          // load test's created count drift below the true number of executions.
          const result = await runAsLeader(key, stealToken, operation, false);
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
 * response and no client needs conflict-handling logic on the routine path.
 */
export async function runIdempotent(
  key: string,
  requestBody: unknown,
  operation: IdempotentOperation,
): Promise<IdempotentResult> {
  increment("requests");
  const requestFingerprint = fingerprint(requestBody);
  const leaderToken = randomUUID();

  const role = await keys.claimLeadership(
    pool,
    key,
    requestFingerprint,
    leaderToken,
    env.IDEMPOTENCY_LEASE_MS,
    env.IDEMPOTENCY_TTL_HOURS,
  );

  if (role === "leader") {
    const result = await runAsLeader(key, leaderToken, operation, false);
    if (result !== LOST_LEASE) return result;
    return awaitOutcome(key, requestFingerprint, operation);
  }

  // The key is taken. Inspect the row before touching it: a mismatched body is key reuse and
  // must be rejected, never reclaimed. Checking inside the reclaim would silently overwrite
  // the original fingerprint and run this body under someone else's key.
  const existing = await keys.find(pool, key);

  if (existing && existing.fingerprint !== requestFingerprint) {
    increment("fingerprintMismatches");
    throw new IdempotencyKeyReusedError();
  }

  // A previous attempt on this key failed. Exactly one of a racing set wins the takeover and
  // re-runs it; the rest fall through to waiting.
  if (
    existing?.state === "failed" &&
    (await keys.reclaimFailed(pool, key, requestFingerprint, leaderToken, env.IDEMPOTENCY_LEASE_MS))
  ) {
    const result = await runAsLeader(key, leaderToken, operation, false);
    if (result !== LOST_LEASE) return result;
  }

  return awaitOutcome(key, requestFingerprint, operation);
}

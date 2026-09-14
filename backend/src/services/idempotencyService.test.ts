import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db/pool.js";
import { IdempotencyKeyReusedError } from "../domain/errors.js";
import * as metrics from "../metrics.js";
import * as keys from "../repositories/idempotencyRepository.js";
import * as products from "../repositories/productRepository.js";
import { type Executed, fingerprint, runIdempotent } from "./idempotencyService.js";

const body = { name: "Widget", price: 19.99 };

function uniqueKey(): string {
  return `test-${randomUUID()}`;
}

function succeeds(resourceId: number, marker = "leader"): () => Promise<Executed> {
  return async () => ({ status: 201, body: { marker }, resourceId });
}

beforeEach(() => {
  metrics.reset();
});

afterAll(async () => {
  await pool.end();
});

describe("concurrent duplicate requests", () => {
  it("runs the operation exactly once and gives every caller the same response", async () => {
    const key = uniqueKey();
    let executions = 0;

    const operation = async (): Promise<Executed> => {
      executions += 1;
      await sleep(30);
      return { status: 201, body: { id: 42 }, resourceId: 42 };
    };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => runIdempotent(key, body, operation)),
    );

    expect(executions).toBe(1);
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.every((r) => JSON.stringify(r.body) === JSON.stringify({ id: 42 }))).toBe(true);

    // Exactly one caller did the work; the other seven were coalesced onto it.
    expect(results.filter((r) => !r.coalesced)).toHaveLength(1);
    expect(results.filter((r) => r.coalesced)).toHaveLength(7);

    const snapshot = metrics.snapshot();
    expect(snapshot.requests).toBe(8);
    expect(snapshot.leaderExecutions).toBe(1);
    expect(snapshot.coalescedResponses).toBe(7);
    expect(snapshot.dedupRate).toBeCloseTo(7 / 8);
  });

  it("never returns 409 to any caller", async () => {
    const key = uniqueKey();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => runIdempotent(key, body, succeeds(1))),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("replays the stored response to a retry long after completion", async () => {
    const key = uniqueKey();
    const first = await runIdempotent(key, body, succeeds(7));
    const second = await runIdempotent(key, body, succeeds(7, "should-not-run"));

    expect(first.coalesced).toBe(false);
    expect(second.coalesced).toBe(true);
    expect(second.body).toEqual({ marker: "leader" });
  });
});

describe("leader crash and lock steal", () => {
  it("lets a waiter take over when a dead leader's lease expires", async () => {
    const key = uniqueKey();

    // A process that claimed the key and died: the row exists, nothing renews its lease, and
    // nothing will ever settle it. Claiming through the repository rather than the service is
    // what makes it dead, because no heartbeat is started.
    await keys.claimLeadership(pool, key, fingerprint(body), randomUUID(), 1, 24);
    await sleep(30);

    const takeover = await runIdempotent(key, body, succeeds(2, "stole-it"));

    expect(takeover.body).toEqual({ marker: "stole-it" });
    expect(metrics.snapshot().lockSteals).toBe(1);
    expect((await keys.find(pool, key))?.state).toBe("completed");
  });

  it("does not steal from a leader that is slow but alive", async () => {
    const key = uniqueKey();
    let started = false;

    // Runs far longer than the 150ms test lease. The heartbeat keeps renewing, so the lease
    // stays valid and no waiter takes over. Without renewal this livelocks: every replacement
    // leader is slow too, so each one is stolen from and rolled back in turn.
    const slowLeader = runIdempotent(key, body, async () => {
      started = true;
      await sleep(700);
      return { status: 201, body: { marker: "finished" }, resourceId: 20 };
    });

    while (!started) await sleep(5);
    const waiter = runIdempotent(key, body, succeeds(21, "should-not-run"));

    expect((await slowLeader).body).toEqual({ marker: "finished" });
    expect((await waiter).body).toEqual({ marker: "finished" });
    expect(metrics.snapshot().lockSteals).toBe(0);
    expect(metrics.snapshot().fencedRollbacks).toBe(0);
    expect(metrics.snapshot().leaderExecutions).toBe(1);
  });

  it("rolls back a stale leader's writes rather than duplicating the row", async () => {
    // Regression test. Fencing only the settle let a slow leader's INSERT commit anyway,
    // which produced 28 duplicate products across 28 steals under load.
    const key = uniqueKey();
    const name = `Fenced ${randomUUID()}`;
    const fields = {
      name,
      description: "fencing regression",
      price: 1.5,
      category: "test",
      stockQuantity: 1,
      manufacturer: "acme",
      releaseDate: "2024-01-01",
      rating: 3,
    };

    let takenOver: Promise<unknown> | null = null;

    const displacedLeader = await runIdempotent(key, body, async (tx) => {
      const product = await products.insert(tx, fields);

      // Simulate another node winning the key while this leader's insert is uncommitted.
      // Rewriting leader_token directly is deterministic, where racing a real lease would
      // depend on timing; the leader now cannot satisfy its own fencing check.
      await pool.execute("UPDATE idempotency_key SET leader_token = ? WHERE idempotency_key = ?", [
        randomUUID(),
        key,
      ]);
      takenOver = keys.settle(pool, key, (await keys.find(pool, key))!.leaderToken, {
        state: "completed",
        status: 201,
        body: { marker: "other-node" },
        resourceId: 999,
      });

      return { status: 201, body: product, resourceId: product.id };
    });

    await takenOver;

    // The displaced leader does not fail. It discovers the winner's outcome and returns it.
    expect(metrics.snapshot().fencedRollbacks).toBe(1);
    expect(metrics.snapshot().leaderExecutions).toBe(0);
    expect(displacedLeader.body).toEqual({ marker: "other-node" });
    expect(displacedLeader.coalesced).toBe(true);

    // The rolled-back insert left nothing behind. Before the fix it committed anyway, which
    // is what produced 28 duplicate products under load.
    const [rows] = await pool.query<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM product WHERE name = ?",
      [name],
    );
    expect(rows[0]?.total).toBe(0);
  });

  it("refuses a revived leader's result once its lease was stolen", async () => {
    const key = uniqueKey();
    const original = randomUUID();

    await keys.claimLeadership(pool, key, "fingerprint", original, 1, 24);
    await sleep(20);

    const thief = randomUUID();
    expect(await keys.stealLeadership(pool, key, thief, 5_000)).toBe(true);

    // The original leader comes back and tries to record its outcome.
    const acceptedStale = await keys.settle(pool, key, original, {
      state: "completed",
      status: 201,
      body: { marker: "stale" },
      resourceId: 1,
    });

    expect(acceptedStale).toBe(false);
    expect((await keys.find(pool, key))?.state).toBe("processing");
  });
});

describe("failure propagation", () => {
  it("fails waiters immediately instead of making them wait out the budget", async () => {
    const key = uniqueKey();

    const leader = runIdempotent(key, body, async () => {
      await sleep(60);
      throw new Error("pipeline exploded");
    });

    await sleep(10);
    const startedAt = Date.now();
    const waiter = runIdempotent(key, body, succeeds(3, "should-not-run"));

    await expect(leader).rejects.toThrow("pipeline exploded");
    await expect(waiter).rejects.toThrow("pipeline exploded");

    // The wait budget is 4000ms; a waiter that polled it out would take far longer.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(metrics.snapshot().leaderFailures).toBe(1);
  });

  it("lets the same key be retried after a failure", async () => {
    const key = uniqueKey();

    await expect(
      runIdempotent(key, body, async () => {
        throw new Error("transient");
      }),
    ).rejects.toThrow("transient");

    const retry = await runIdempotent(key, body, succeeds(9, "recovered"));

    expect(retry.body).toEqual({ marker: "recovered" });
    expect(retry.coalesced).toBe(false);
  });
});

describe("key reuse", () => {
  it("rejects a key replayed with a different body", async () => {
    const key = uniqueKey();
    await runIdempotent(key, body, succeeds(4));

    await expect(
      runIdempotent(key, { name: "Different", price: 1 }, succeeds(5)),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("rejects a different body on a key whose previous attempt failed", async () => {
    // Regression test. Reclaiming a failed key used to match on state alone and overwrite the
    // stored fingerprint, so an unrelated body could take over someone else's key.
    const key = uniqueKey();

    await expect(
      runIdempotent(key, body, async () => {
        throw new Error("transient");
      }),
    ).rejects.toThrow("transient");

    await expect(
      runIdempotent(key, { name: "Totally different", price: 1 }, succeeds(11)),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    // The original fingerprint survived, so the legitimate retry still works.
    const retry = await runIdempotent(key, body, succeeds(12, "recovered"));
    expect(retry.body).toEqual({ marker: "recovered" });
  });

  it("treats keys differing only by case as distinct", async () => {
    // Regression test. utf8mb4's default collation is case-insensitive, which would merge
    // these two keys into one and silently skip the second create.
    const base = uniqueKey();
    const lower = `${base}-abc`;
    const upper = `${base}-ABC`;

    const first = await runIdempotent(lower, body, succeeds(13, "lower"));
    const second = await runIdempotent(upper, body, succeeds(14, "upper"));

    expect(first.body).toEqual({ marker: "lower" });
    expect(second.body).toEqual({ marker: "upper" });
    expect(second.coalesced).toBe(false);
  });

  it("treats key order in the body as insignificant", async () => {
    const key = uniqueKey();
    await runIdempotent(key, { a: 1, b: 2 }, succeeds(6));

    const reordered = await runIdempotent(key, { b: 2, a: 1 }, succeeds(6, "should-not-run"));
    expect(reordered.coalesced).toBe(true);
  });
});

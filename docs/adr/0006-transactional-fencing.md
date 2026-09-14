# ADR-0006: Fence a leader's work inside its own transaction

## Status
Accepted

## Date
2026-09-14

## Context

[ADR-0004](0004-coalescing-over-rejection.md) lets a waiter steal leadership when the leader's
lease expires, so a crashed process cannot strand every duplicate until the wait budget runs
out.

The first implementation gave each leader a `leader_token` and required it to match on the
settling `UPDATE`, so a revived leader could not overwrite the result of whoever displaced it.

Load testing broke it. A 60-second run at 400 rps produced **5,813 product rows against 5,785
idempotency keys**, a gap of exactly 28 matching that run's 28 lock steals.

## Decision

Run the operation inside the leader's transaction, and commit the fenced ownership `UPDATE`
atomically with it:

```sql
BEGIN;
  INSERT INTO product …;
  UPDATE idempotency_key
     SET state = 'completed', response_body = …
   WHERE idempotency_key = ? AND leader_token = ?;
  -- affectedRows = 0 means the lease was stolen: ROLLBACK, insert included
COMMIT;
```

A displaced leader matches zero rows, rolls back everything including its insert, and falls
through to waiting for whoever took over.

The operation signature changed to receive the transaction, so a caller cannot accidentally
write outside the fence.

## Why the first version was wrong

A lease proves a leader stopped *renewing*. It never proves the leader stopped *working*.
Under load some leaders exceeded the 500ms lease while still mid-insert, so a waiter stole the
key and ran the operation a second time while the first insert was still in flight.

Fencing the token guarded the *bookkeeping*. It did nothing about the *side effect*. Making
the ownership check and the side effect one atomic unit is the only thing that closes it.

## The lease also has to be renewed

Fencing makes a steal *safe*. It does not make one *rare*, and an adversarial review of this
design found the gap: nothing renewed a live leader's lease, so the lease was not a liveness
signal at all but a hard deadline on the operation.

That is worse than it sounds. Under a sustained slowdown every leader exceeds the lease, gets
stolen from, rolls back, and its replacement is equally slow and stolen from in turn. The key
makes no forward progress while burning an insert per cycle, until every waiter times out.
Fencing turns a duplicate-row bug into a livelock rather than removing the problem.

So the leader now heartbeats its lease every `lease / 3` while it works, and renews once more
immediately after acquiring its pooled connection, because under a burst that wait could
otherwise consume most of the lease before any work began.

With renewal in place a steal means what the name implies: the process holding the key stopped
running. Six 60-second runs at 400 rps recorded **zero steals and zero fenced rollbacks across
143,689 requests**.

## Alternatives considered

**Lengthen the lease.** Makes the race rarer without removing it, and the lease also sets how
long a genuinely dead leader strands its waiters. Tuning cannot fix a correctness bug.

**Heartbeat instead of fencing.** Renewal alone shrinks the window without closing it: a
process stalled by GC or a blocked event loop stops heartbeating while its in-flight query
still lands. Renewal and fencing solve different halves, and both are needed.

**Drop takeover entirely.** The first design had no steal path and therefore no bug. Rejected:
without it, a crashed leader strands every duplicate for the full wait budget.

**Rely on a natural unique constraint on the product.** Would stop the duplicate at the
database. Rejected: products have no natural key, and inventing one would be a business rule
invented to patch a concurrency defect.

## Consequences

- Zero duplicate rows across 143,689 requests, in every configuration swept, including past
  the saturation point.
- Zero steals and zero fenced rollbacks in the six runs after renewal was added, where the
  unrenewed version was stealing under ordinary load.
- A leader holds a pooled connection for its whole transaction, which contributed to pool
  pressure and informed raising the pool to 100.
- Steals are safe but not free: the displaced leader's work is rolled back and redone. The
  `fencedRollbacks` metric exposes this, and a non-zero value means leases are expiring faster
  than the pipeline completes.
- Guarded by `idempotencyService.test.ts`, "rolls back a stale leader's writes rather than
  duplicating the row", which drives a real insert through a deliberately stalled leader.

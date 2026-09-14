# ADR-0004: Coalesce concurrent duplicates instead of rejecting them

## Status
Accepted

## Date
2026-09-14

## Context

[ADR-0003](0003-idempotency-keys.md) settles which caller performs the work. It does not settle
what the losing callers receive while the winner is still running.

The first implementation answered them with `409 REQUEST_IN_FLIGHT` and expected the client to
retry. It measured well: **p99 8.2-8.5ms across three 60-second runs at 400 rps**, with a
run-to-run spread of 1.04x. About 16% of requests at steady state received a 409.

The cost sat with every client, each of which had to implement retry-on-409 correctly to get
the guarantee.

## Decision

Duplicates become waiters rather than rejections. The leader records its outcome on the
`idempotency_key` row; waiters poll that row and return whatever the leader recorded. `409` is
gone from the API contract, and every caller receives an ordinary 200 or 201.

Supporting parts:

- **Poll interval 15ms, jittered ±40%.** Measured, not guessed. See below.
- **Wait budget 2000ms**, after which a waiter gets 504 and should retry the same key. 504
  rather than 409, because the request is still legitimately in flight somewhere.
- **A leader failure is recorded as `failed`**, so waiters fail immediately instead of burning
  the whole budget.
- **A later request may reclaim a `failed` key** and re-run it. Without that, one transient
  failure would poison the key forever, defeating the point of idempotency keys.

## The poll interval is measured

Sweeping at 400 rps produced a U-curve:

| pool | poll | p99 |
|---|---|---|
| 20 | 4ms | 386.00ms |
| 60 | 4ms | 273.53ms |
| 60 | 15ms | 74.97ms |
| 100 | 15ms | **70.68ms** |
| 100 | 25ms | 112.97ms |

Polling faster is worse: each waiter issues a `SELECT` per poll, and at 4ms with hundreds of
concurrent waiters that read amplification saturates the pool and starves the leaders the
waiters are blocked on. Polling slower is worse for the opposite reason. Pool size mattered
far less than interval.

The original instruction specified a 300-500ms interval and a cap of twice p99. Both were
rewritten because they assume a seconds-scale pipeline: this one runs at single-digit
milliseconds, so 300ms would make every waiter far slower than the work it waits on, and a
17ms cap is shorter than one poll.

## Alternatives considered

**Keep 409 and let clients retry.** Best measured tail latency, and what Stripe does. Rejected
on instruction, and the trade is real: it moves correctness-critical logic into every client.

**Block on the unique index instead of polling.** Concurrent inserts on the same key already
wait in InnoDB, so the database would do the serialising. Rejected: every duplicate then holds
a connection for the leader's full duration, which inflates exactly the tail this is trying to
protect.

**Notify rather than poll (LISTEN/NOTIFY or similar).** Removes the read amplification
entirely. Rejected: MySQL has no such primitive, and adding a message broker to avoid a 15ms
poll is not a trade worth making at this scale.

## Consequences

- No client needs conflict-handling logic on the routine path. That is the whole benefit, and
  it is not absolute: a waiter that exhausts its budget still receives a 504 telling it to
  retry the same key, so degraded mode does ask something of the client.
- **p99 rose from 8.2-8.5ms to 23.6-394.9ms** across six 60-second runs, median 86.6ms. The
  409-rejecting design held a 1.04x spread between its best and worst run; this one does not.
  Both the median and the range belong in any honest description of the trade.
- Correctness is identical under both designs. Only the client contract and the tail differ.
- Waiters hold no transaction while polling, but they do consume a pool connection per poll,
  which is why pool size was raised to 100.
- Lease-based takeover arrived with this design and brought a duplicate-row defect with it.
  See [ADR-0006](0006-transactional-fencing.md).

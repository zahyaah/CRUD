# Debugging notes

Sixteen bugs found during the revamp. Two came from the original code and fourteen were mine.

Eleven of mine were found by review rather than by testing: one pass reading the concurrency
design cold against a written contract, a second reading the whole diff. Most had no symptom and
no failing test. Every defect a test could catch, the tests caught; the rest needed someone
reading for what the code does rather than what it was meant to do.

---

## 1. Duplicate rows from lease-based takeover

**Mine. The most serious of those with a symptom.**

**Symptom.** A 60-second load run at 400 rps produced 5,813 product rows against 5,785
idempotency keys. The gap of 28 matched the run's 28 lock steals exactly.

**Expected.** One row per idempotency key, always.

**Investigation.** `COUNT(*) - COUNT(DISTINCT name)` returned 28, and the duplicated names
came in pairs created about a second apart. Pairing the count with the `lockSteals` metric
made the correlation obvious, and the timestamps ruled out retries of failed requests.

**Root cause.** A lease tells you a leader stopped *renewing*. It never tells you the leader
stopped *working*. Under load some leaders exceeded their 500ms lease while still mid-insert.
A waiter saw the expired lease, stole leadership and ran the operation again. The stale
leader's `leader_token` fence stopped it *recording* its result, but nothing stopped its
`INSERT` from committing. Two inserts, one key.

This is the fencing-token problem: guarding the bookkeeping is not the same as guarding the
side effect.

**Fix.** Run the operation inside the leader's transaction, with the fenced ownership `UPDATE`
committing atomically alongside it. A leader that lost its lease matches zero rows, rolls the
whole transaction back including the insert, and falls through to waiting for whoever
displaced it.

**Guard.** `idempotencyService.test.ts`, "rolls back a stale leader's writes rather than
duplicating the row". It drives a real insert, then rewrites `leader_token` mid-transaction to
simulate another node winning the key, so the assertion does not depend on lease timing.

**Cost of the lesson.** The first design rejected concurrent duplicates with 409 and had no
steal path, so it never had this bug. Taking on lease-based takeover bought a simpler client
contract and brought this failure mode with it.

---

## 2. Polling faster made the service slower

**Mine.**

**Symptom.** After coalescing replaced 409 rejection, p99 went from 8.4ms to 386ms and one
60-second run failed to finish inside eight minutes.

**Investigation.** `threads_connected` sat at the pool ceiling. Sweeping the poll interval and
the pool size separately showed poll interval dominated by roughly 5x while pool size barely
moved the number.

| pool | poll | p99 |
|---|---|---|
| 20 | 4ms | 386.00ms |
| 60 | 4ms | 273.53ms |
| 60 | 15ms | 74.97ms |
| 100 | 15ms | **70.68ms** |
| 100 | 25ms | 112.97ms |

**Root cause.** Each waiter issues a `SELECT` per poll. At 4ms with hundreds of concurrent
waiters, that read amplification saturated the connection pool and starved the leaders the
waiters were blocked on. Polling slower is worse for the opposite reason: waiters sit idle
after the leader has already finished.

**Fix.** Default the interval to 15ms, at the bottom of the U-curve, and make it configurable.
The reasoning is recorded in `config/env.ts` so nobody "optimises" it back down.

---

## 3. A server that is up and answers nothing

**Original code.**

**Symptom.** Running the `pre-revamp` server against a database it could not reach printed
`Server running on 3001`, then `Can't connect to the database`, and kept listening. A
`GET /products` logged a morgan line with no status code and no duration. The request never
returned.

**Root cause.** `server.js:28-34` logs the connection error and returns. Nothing exits, nothing
retries, and the HTTP listener starts regardless. Every query callback is then registered
against a dead connection and never fires, so requests hang until the client times out.

**Why it matters.** A port-based health check reports this server as healthy while it black-holes
every request. The revamped `/health` runs `SELECT 1` through the pool, so a database it cannot
reach fails the check.

---

## 4. Works on macOS, breaks on Linux

**Original code.**

**Symptom.** The legacy server returned 500 on every read once pointed at the MySQL container,
having worked on the developer's machine.

**Root cause.** `server.js:44` selects from `PRODUCT` while `:110` deletes from `product`.
MySQL folds table-name case according to the host filesystem: case-insensitive on macOS,
case-sensitive on Linux. The inconsistency was invisible where the code was written and fatal
in the container.

This was flagged by reading in Step 2 and confirmed by running in Step 7. The revamped code
uses one casing throughout.

---

## 5. A screen-reader label stretched the page

**Mine.**

**Symptom.** At 390px the inventory page scrolled horizontally. `document.documentElement.scrollWidth`
was 632 while `clientWidth` was 390, even though the table's scroll container was correctly
clipping at 356.

**Investigation.** Walking up from the table showed every ancestor contained at 390. Listing
absolutely positioned elements found `.visually-hidden` spans sitting at x=631, matching the
document's 632 exactly.

**Root cause.** The `.visually-hidden` labels inside the table's action buttons are
`position: absolute`, and nothing in their ancestry was positioned. They resolved against the
initial containing block, escaped the table's `overflow-x` container at their static x offset,
and extended the document's scroll area.

A first attempt at `min-width: 0` on the wrapper was aimed at the usual flexbox culprit and
did not touch this.

**Fix.** `position: relative` on the scroll container, so the absolutely positioned labels
resolve inside it.

**Guard.** A Playwright check asserting `scrollWidth === clientWidth` at 390, 768 and 1280.
Reading the CSS would not have caught this.

---

## 6. The lease was a deadline, not a liveness signal

**Mine. Found by adversarial review, not by testing.**

**Symptom.** None observed. Three comments asserted that a leader had "stopped renewing", and
`grep -rn renew backend/src` matched only those comments. Nothing ever extended a live leader's
lease.

**Root cause.** Without renewal the lease is a hard 800ms ceiling on the operation rather than
a signal that the process died. A leader merely slower than its lease gets stolen from, rolls
back, and its replacement is equally slow and stolen from in turn. A sustained slowdown does
not degrade the endpoint, it livelocks the key: no forward progress, one wasted insert per
cycle, until every waiter times out.

Fencing had turned a duplicate-row bug into a liveness bug, which is a quieter failure and
harder to spot.

**Fix.** Heartbeat the lease every `lease / 3` while the operation runs, and renew once more
immediately after acquiring the pooled connection, since under a burst that wait could consume
most of the lease before any work began.

**Evidence it worked.** Zero lease steals and zero fenced rollbacks across 143,689 requests in
six runs. The unrenewed version was stealing under ordinary load.

**Guard.** A test asserting that a leader running far beyond its lease is *not* stolen from.
The two existing steal tests had modelled a slow leader and a dead one as the same thing, which
is precisely the conflation that caused the bug; they now model death by claiming the key
through the repository so no heartbeat ever starts.

---

## 7. A failed key could be hijacked by an unrelated request

**Mine. Found by adversarial review.**

**Symptom.** None observed. No test covered it.

**Root cause.** After an operation failed, `reclaimFailed` matched on `state = 'failed'` alone
and *set* `request_fingerprint` to the incoming body's hash. A request arriving with a
different body took the key over, ran its own work under someone else's key, and destroyed the
original fingerprint, so every later retry of the real request was rejected as key reuse.

The 422 path was tested only for keys in the `completed` state, so the hole sat in the gap
between two tests that each looked complete.

**Fix.** Read the row and compare the fingerprint before touching it; a mismatch is 422 and
never reaches the reclaim. `reclaimFailed` also matches the fingerprint in its `WHERE` clause,
closing the race between the check and the update.

---

## 8. Two distinct keys were the same key

**Mine. Found by adversarial review.**

**Root cause.** `idempotency_key VARCHAR(255)` under `utf8mb4` with no explicit collation
resolves to `utf8mb4_0900_ai_ci` on MySQL 8, which is case- and accent-insensitive. Idempotency
keys are opaque byte strings and base64 and ULIDs both use mixed case, so `AbC` and `abc`
collided on the primary key. The second caller's create would never run and it would be handed
the first caller's product.

Separately, the route validated the *trimmed* header and then used the *raw* one, so `"abc "`
and `"abc"` were two keys and two products.

**Fix.** `COLLATE utf8mb4_bin` on the column, and key on the trimmed value.
[ADR-0009](adr/0009-key-identity.md).

---

## 9. The measurements claimed more than the script measured

**Mine. Found by adversarial review.**

**Symptom.** `measurements.json` reported `dbRows`, `duplicateRows` and `productsLost` in every
table. The k6 script emits none of those and cannot: k6 has no MySQL client.

The numbers were real, collected by querying the container after each run. Nothing in the file
said so, which makes honest data look invented.

Two contradictions sat alongside it: the file claimed no headline rested on excluding the
outlier run while publishing `p99RangeExcludingOutlier` as the headline, and reported a 0%
error rate for a run that recorded three timeouts.

**Fix.** A `provenance` block stating exactly which numbers come from k6, which from SQL, and
which from `/metrics`. The outlier is quoted in the range. `dedupRate` was renamed
`injectedDuplicateRatio`, because 75% is fixed by the workload generator and describes the test
rather than the system.

**Worth keeping.** The reviewer could not distinguish a transcribed measurement from a
fabricated one, and neither could a reader. Unprovenanced numbers are worth roughly what
invented ones are.

---

## 10. A deadlock the load tests could not reach

**Mine. Found by a review of the whole diff.**

**Symptom.** None. Six 60-second runs at 400 rps passed with zero duplicates and no timeouts.

**Root cause.** A leader checks out a connection from the main pool for its transaction, then
issues its lease renewals against that same pool. Once concurrent leaders reach the pool size,
every renewal queues behind connections held by the very transactions waiting on those
renewals. `queueLimit: 0` means no bound and no acquire timeout, so nothing releases and
`connection.release()` is never reached. The process stops answering entirely, `/health`
included.

**Why load testing missed it.** At 400 rps against operations finishing in single-digit
milliseconds, only two or three leaders are in flight at once against a pool of a hundred.
Reaching saturation needs a burst or a slow database, and the workload was built to prove
correctness under duplicates rather than to exhaust the pool.

**Fix.** Renewals run on a dedicated `leasePool`. They cannot share the transaction's
connection either: a renewal inside an uncommitted transaction is invisible to every other
process, which is the one thing it exists to do.

**Guard.** None yet. Reproducing it means driving the pool to saturation, which the current
single-machine rig cannot do. That is the most valuable test still missing.

---

## Also found in that pass

- `Date.parse` accepts impossible calendar dates and rolls them forward, so 29 February in a
  non-leap year passed validation and then failed in MySQL strict mode. A bad request reached
  the client as a server error.
- The edit form seeded its draft once and was not keyed by row, so opening a second product
  without cancelling kept the first one's values and would save them under the second one's id.
- The idempotency key rotated only after a successful create, so correcting a rejected form and
  resubmitting sent a new body under the old key, which is key reuse and is refused permanently.
- A lease steal reported itself as a coalesced response, so a request that had done the work
  claimed it had not, and the load test's execution count drifted below the truth.
- Malformed JSON and oversized bodies matched no typed error, so they were logged as unhandled
  faults and answered with 500 instead of 400 or 413.
- A leader's typed error was flattened to a bare one before reaching its waiters, so coalesced
  callers could receive a 500 where the leader's own client got a 4xx.

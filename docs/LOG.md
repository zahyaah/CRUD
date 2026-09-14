# Revamp log

Running record of the revamp, one entry per step. Consolidated decisions live in
[`docs/adr/`](adr/); measured numbers live in
[`loadtest/results/measurements.json`](../loadtest/results/measurements.json).

---

## 2026-09-14 · Step 1: fix the boundary

Tagged `pre-revamp` on `1c8f121` (2024-08-12, "everything").

The repo held two commits three minutes apart and nothing else: no tags, no branches, no PRs,
no issues. HEAD *was* the before-state, so there was no prior revamp to diff against and
Steps 2-4 could not run in their stated order. Reordered to: snapshot before, build, then
diff.

Motivation is not recorded anywhere in the repo. The only sourced statement of intent is
`package.json`'s `"name": "hackathon-zayd"`. The owner supplied the rest on 2026-09-14: turn a
hackathon app into something an interviewer finds more interesting the deeper they dig.

---

## 2026-09-14 · Step 2: map the before-state

Wrote [`architecture-before.md`](architecture-before.md) from a full read of all 1,060 lines.

Every pain point is cited to a line in `pre-revamp`. Three later proved to be real failures,
not just code smells, once the legacy server was actually run (see Step 7).

Largest finding: the nine product fields were hand-written in eight separate places across
backend and frontend. That single fact is the strongest argument for the TypeScript
migration, because it is a countable defect surface rather than a style preference.

---

## 2026-09-14 · Step 5: migrate to TypeScript

Replaced `backend/server.js` with a layered TypeScript backend and extracted the product
contract into a `@warehouse/shared` workspace that both tiers compile against.

`strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are all on. The shared
package is what actually closes the eight-places duplication: adding a column is now one edit,
and a miss is a compile error in both the API and the UI.

Two security findings fell out of the dependency review: `morgan` was a devDependency required
at runtime, and the `pre-revamp` lockfile pinned a `mysql2` range carrying a high-severity
advisory. Upgraded 3.11 to 3.24; production dependencies now report zero vulnerabilities.

Deleted a `withTransaction` helper written during this step after a dead-export scan showed
zero call sites. It came back in Step 7 when a real defect demanded it.

Decisions: [ADR-0001](adr/0001-typescript-migration.md).

---

## 2026-09-14 · Step 7: concurrency correctness

Built idempotent creates and optimistic locking, then load-tested both against the original
server.

The first design answered concurrent duplicates with `409 REQUEST_IN_FLIGHT` and measured p99
8.2-8.5ms across three runs. On the owner's instruction it was replaced with request
coalescing, where duplicates wait for the leader and receive its recorded response, removing
409 from the client contract entirely.

Coalescing then failed its own load test: 5,813 product rows against 5,785 idempotency keys,
a gap of exactly 28 matching 28 lock steals. Root cause is that a lease proves a leader
stopped renewing, never that it stopped working, so a merely slow leader had its key stolen
mid-insert. Fixed by running the operation inside the leader's transaction alongside the
fenced ownership check, so a displaced leader's insert rolls back with everything else.

Zero duplicate rows across roughly 142,700 requests since, verified in the database rather
than from HTTP responses.

Decisions: [ADR-0003](adr/0003-idempotency-keys.md),
[ADR-0004](adr/0004-coalescing-over-rejection.md),
[ADR-0005](adr/0005-optimistic-locking.md),
[ADR-0006](adr/0006-transactional-fencing.md).

---

## 2026-09-14 · Step 6: rebuild the frontend

Replaced four hand-written HTML pages with a React 18 + Vite + TanStack Query application:
inventory with conflict-aware editing, a create form, and a concurrency lab that fires
simultaneous duplicates from the browser and shows the leader/waiter split live.

Verified in headless Chromium rather than by inspection. Ten simultaneous creates produced one
leader, nine waiters and one product, with no console errors. Two layout defects surfaced that
reading the CSS would not have caught, both recorded in
[`debugging-notes.md`](debugging-notes.md).

Decisions: [ADR-0002](adr/0002-react-frontend.md).

---

## 2026-09-14 · Step 8: design patterns

Two patterns kept, four rejected. Each rejection names the simpler construct that does the
same work, which matters more than the list of patterns adopted.

Decisions: [ADR-0007](adr/0007-patterns-applied-and-rejected.md).

---

## 2026-09-14 · Step 9: quality pass

Found and fixed three defects the earlier steps had missed.

`GET /products` was unbounded and returned all 6,002 rows during load testing; it now pages
with a default of 50 and a hard cap of 200. The concurrency lab fetched the entire product
list twice per burst to read `.length`, which is now a single `limit=1` request reading the
page total. The `useProduct` hook and its API client function had zero call sites and were
removed.

Audited every comment against the "why, not what" rule and stripped em dashes throughout.

Decisions: [ADR-0008](adr/0008-bounded-list-endpoint.md).

---

## 2026-09-14 · Steps 3 and 4: map the after-state and the diff

Wrote [`architecture-after.md`](architecture-after.md) and
[`change-narrative.md`](change-narrative.md). Each change cites the `pre-revamp` line it
replaces and the ADR that justifies it. Both were written last because the after-state did not
exist until Steps 5-9 built it.

---

## 2026-09-14 · Step 11: interview-harden the decisions

Ran the concurrency work and the pattern choices past a fresh-context adversarial reviewer,
given the artifact and the contract but not the reasoning.

It found four defects. Three were real correctness violations that no existing test covered:
no lease renewal anywhere, so fencing had converted a duplicate-row bug into a potential
livelock; `reclaimFailed` matching on state alone, letting an unrelated body hijack a failed
key; and a case-insensitive collation on the key's primary key, silently merging distinct keys.
The fourth was that `measurements.json` reported row counts the load script cannot produce.

All four fixed, with three new regression tests. Re-measured from scratch afterwards, because
the earlier numbers came from code carrying the livelock and the wrong collation.

Decisions: [ADR-0009](adr/0009-key-identity.md), plus a lease-renewal section added to
[ADR-0006](adr/0006-transactional-fencing.md).

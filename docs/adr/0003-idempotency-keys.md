# ADR-0003: Enforce idempotency with a client key and a database unique constraint

## Status
Accepted

## Date
2026-09-14

## Context

`POST /products` at `pre-revamp` took a client-supplied primary key (`server.js:73`) and had
no duplicate handling. A resubmitted form hit a duplicate-key violation that `server.js:80-81`
collapsed into `{"Error": "Internal Server Error"}`.

Running the original server under a duplicate-burst workload made the cost concrete: **75.0%
of requests returned 500**, in every run (18,000 of 24,001). The product had been created, so
the caller could not distinguish a duplicate from an outage, and retrying was unsafe.

## Decision

Require an `Idempotency-Key` header on `POST /products`. Record it in an `idempotency_key`
table whose `PRIMARY KEY` is the key itself, alongside a SHA-256 fingerprint of the request
body and the stored response.

Concurrent callers race to `INSERT`. Exactly one wins; the rest get `ER_DUP_ENTRY`. The
database is the arbiter, so the guarantee holds across any number of API instances with no
coordination between them.

A key replayed with a different body returns 422 rather than the stored response, because that
is a client bug and not a retry. The fingerprint sorts object keys before hashing, so a client
that reorders its JSON is not misread as reuse.

The id moved to `AUTO_INCREMENT`. While the client chose the primary key, a resubmit was
indistinguishable from a genuine conflicting create by another user.

## Alternatives considered

**Hash the payload, no client header.** No client change needed. Rejected: two users
legitimately creating identical products become indistinguishable from one double-click. That
is a correctness hole, and an interviewer finds it immediately.

**Application-level lock or in-memory set.** Simple to write. Rejected: it holds only within
one process. Two API instances both accept the duplicate, which is precisely the case
idempotency is supposed to survive.

**Redis with a TTL.** Fast, and the conventional answer. Rejected here because it introduces a
second source of truth that can disagree with MySQL about whether the write happened. The
unique constraint already provides the mutual exclusion, in the same transaction as the data.

## Consequences

- Zero duplicate rows across roughly 142,700 load-tested requests, verified with
  `COUNT(*) - COUNT(DISTINCT name)` in the database rather than from HTTP responses.
- Clients must generate and reuse a key across retries. The React form generates one per form
  instance, not per submit.
- The ledger grows and needs eventual pruning; rows carry `expires_at` but no reaper is
  running yet.
- Extended by [ADR-0004](0004-coalescing-over-rejection.md), which decides what a losing caller
  receives, and [ADR-0006](0006-transactional-fencing.md), which keeps takeover safe.

# ADR-0005: Optimistic locking on updates with a version column

## Status
Accepted

## Date
2026-09-14

## Context

`PUT /products/:id` at `pre-revamp` (`server.js:89-103`) wrote every column unconditionally.
Two people editing the same product both succeeded, and whichever `UPDATE` landed second
silently erased the other's changes. Nothing recorded that it happened.

The row's only guard was `req.body.length > 8` at `server.js:92`, which reads `.length` on a
plain object. `undefined > 8` is always false, so the check never fired.

## Decision

Add a `version` column. Clients send the version they read as `expectedVersion`, and the update
applies only if the row still carries it:

```sql
UPDATE product
   SET …, version = version + 1
 WHERE id = ? AND version = ?
```

Zero matched rows means either the product is gone or someone else already bumped it. One
follow-up read separates the two, because the answers differ: 404 is terminal, 409 is
retryable after re-reading. The 409 carries `actualVersion` so the client can rebase without a
second round trip.

## Alternatives considered

**Pessimistic locking (`SELECT … FOR UPDATE`).** Prevents the conflict outright. Rejected:
it holds a row lock across user think-time, which for a form a person is typing into means
holding a database lock for minutes.

**Last-write-wins, as before.** Zero work. Rejected: it is the bug.

**`updated_at` timestamp instead of an integer version.** No extra column, since the timestamp
already exists. Rejected: timestamp precision makes two updates inside the same tick
indistinguishable, and clock adjustments make it worse. A monotonic counter has neither problem.

**Field-level merge.** Best user experience, since edits to different fields would not
conflict. Rejected as unearned complexity for a nine-column product form; there is no evidence
users here edit disjoint fields concurrently.

## Consequences

- A lost update is now a reportable 409 instead of silent data loss.
- The UI shows the conflict, refetches, and asks the user to reopen the row with current
  values.
- Clients must round-trip `expectedVersion`. It is part of the shared update schema, so
  omitting it is a validation error rather than a silent full overwrite.
- Unlike creates, updates carry no idempotency key. The version check already makes a replayed
  update a no-op conflict, so a key would add ceremony without adding a guarantee.

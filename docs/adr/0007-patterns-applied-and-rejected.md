# ADR-0007: Design patterns applied, and four rejected

## Status
Accepted

## Date
2026-09-14

## Context

A pattern is worth adopting when it solves a problem you can point at. Reaching for one to look
rigorous adds indirection and nothing else. Each candidate below was tested against a single
question: does a plain function, an enum or an `if` do the same job?

Two survived. Four did not, and the rejections carry more weight than the adoptions, because
the standard follow-up is "why this pattern and not something simpler".

## Applied

### Repository

**Problem.** At `pre-revamp` every SQL string sat inline in an Express handler:
`server.js:44`, `:59`, `:77`, `:95`, `:110`. The write path could not be exercised without
booting an HTTP server and a database.

**Result.** `productRepository` and `idempotencyRepository` take a `Queryable`, which is either
the pool or a transaction. That parameter is what makes [ADR-0006](0006-transactional-fencing.md)
possible: the same repository call joins the leader's transaction when fencing requires it.

**Simpler alternative rejected:** leaving SQL in the handlers. It is fewer files, and it is
what made the original untestable.

### Decorator, as a higher-order function

**Problem.** Idempotency has to wrap a mutating handler without the handler knowing about it.

**Result.** `runIdempotent(key, body, operation)` takes the operation as a closure. Adding
idempotency to another endpoint means wrapping it; the endpoint itself is unchanged.

## Rejected

### Command

**Considered because** the operations are replayable units of work, which is the textbook
description of a Command.

**Rejected because** a closure `(tx) => Promise<Executed>` already does everything the Command
object would. The class version adds an interface, a concrete class per operation and a
dispatcher, and buys no behaviour. There is no undo, no queue, no serialisation of commands.

### State / state machine

**Considered for** `idempotency_key.state`, which moves between `processing`, `completed` and
`failed`.

**Rejected because** there are three states and the transitions are enforced in SQL `WHERE`
clauses, where they belong: `WHERE … AND state = 'failed'` for reclaim, `WHERE … AND
lease_expires_at < NOW(3)` for steal. An enum column plus those predicates is the entire
machine. A State class per state would be three files expressing what one column already says,
and would move the invariant out of the database that enforces it.

### Strategy

**Considered because** an interchangeable-algorithm seam is a common thing to demonstrate.

**Rejected because** there are no interchangeable algorithms here. One persistence backend,
one idempotency mechanism, one validation library. A Strategy interface would have a single
implementation, which is an interface with no purpose.

### Observer / pub-sub

**Considered for** decoupling side effects from the write path.

**Rejected because** there are no side effects to decouple. One write path, no subscribers, no
second consumer. An event bus would add a layer of indirection between a caller and the one
thing it calls. Worth revisiting the day a second consumer exists, and not before.

## Also removed

A `withTransaction` helper written during Step 5 was deleted the same day after a dead-export
scan found zero call sites: every operation was a single atomic statement and needed no
explicit transaction. The transaction boundary returned in Step 7, inline in `runAsLeader`,
once [ADR-0006](0006-transactional-fencing.md) gave it a real job.

Writing it early was speculative. Deleting it and letting a defect reintroduce it is the
sequence worth keeping.

## Consequences

- Two patterns, both traceable to a cited defect.
- The rejected four are documented with the simpler construct that replaced each, so the
  reasoning survives rather than looking like an oversight.

# ADR-0009: Treat the idempotency key as an exact, opaque identifier

## Status
Accepted

## Date
2026-09-14

## Context

[ADR-0003](0003-idempotency-keys.md) makes the database the arbiter of which caller runs the
work, using the key's `PRIMARY KEY` constraint. That guarantee is only as good as the
definition of "the same key", and an adversarial review of the implementation found three
places where two different keys could be treated as one, or one key hijacked by an unrelated
request.

**The primary key was case- and accent-insensitive.** `VARCHAR(255)` under `utf8mb4` with no
explicit collation resolves to `utf8mb4_0900_ai_ci` on MySQL 8. Keys are opaque byte strings,
and base64 and ULIDs both use mixed case, so `AbC` and `abc` collided. The second caller's
create would never run and it would be served the first caller's product.

**The header was validated trimmed but used raw.** `"abc "` and `"abc"` were two keys, so a
retry that picked up trailing whitespace created a second product.

**Reclaiming a failed key did not check the fingerprint.** After a key failed, a request
arriving with a *different* body matched on `state = 'failed'` alone, took the key over, and
overwrote the stored fingerprint. That ran an unrelated body under someone else's key and
permanently locked out the original.

**The fingerprint's key ordering was locale-dependent.** `localeCompare` varies with the ICU
data a process was built against, so two API instances could hash the same body differently
and reject each other's retries as key reuse.

## Decision

- `idempotency_key` is declared `COLLATE utf8mb4_bin`, so keys compare byte for byte.
- The route trims the header once and uses the trimmed value as the key, rather than
  validating one form and keying on another.
- The fingerprint is checked *before* any reclaim: a mismatched body is 422 and never gets
  near the row. `reclaimFailed` additionally matches on the fingerprint in its `WHERE` clause,
  so a racing request cannot slip between the check and the update.
- Fingerprint key ordering compares by code unit, not locale.

## Alternatives considered

**Set the collation database-wide instead of per column.** Fewer places to remember. Rejected:
the product columns genuinely want case-insensitive comparison for search, and only the key is
an opaque identifier. Binary collation is a property of this column, not the schema.

**Normalise keys by lowercasing them.** Would also make comparison deterministic. Rejected: it
*reduces* the key space and makes two genuinely distinct keys collide on purpose, which is the
bug rather than the fix.

**Reject keys containing whitespace instead of trimming.** Stricter and arguably cleaner.
Rejected as unfriendly: a trailing newline from a shell script is not a client bug worth a 400,
and trimming is unambiguous.

## Consequences

- Two keys differing only in case are two keys, covered by a regression test.
- A failed key can only be reclaimed by the body that originally used it. Also covered by a
  regression test, which additionally asserts that the original body can still retry
  afterwards.
- Finding these needed a reviewer working from the artifact and the contract with no access to
  the reasoning behind them. None of the three would have failed a test that had been written
  by the author of the bug.

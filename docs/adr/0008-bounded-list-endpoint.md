# ADR-0008: Bound the product list endpoint

## Status
Accepted

## Date
2026-09-14

## Context

`GET /products` returned `SELECT * FROM PRODUCT` with no limit at `pre-revamp`
(`server.js:43-53`), and the first pass of the revamp carried that forward unchanged.

Load testing made the cost visible rather than theoretical: after a few runs the table held
6,002 rows, and every call to the endpoint serialised all of them. The React inventory page
rendered the lot. The concurrency lab was worse, fetching the entire list twice per burst only
to read `.length`.

The endpoint also returned **410 Gone** for an empty table (`server.js:48-49`), which was
confirmed at runtime against the legacy server. 410 means permanently removed; an empty
collection is a 200.

## Decision

Page the endpoint: `GET /products?limit&offset`, default 50, hard cap 200, returning
`{items, total, limit, offset}`. A limit above the cap is a 400 rather than a silent clamp, so
a client asking for too much learns it did.

The count comes from a separate `COUNT(*)` issued in parallel with the page query.

The concurrency lab now reads `total` from a `limit=1` request, so its cost no longer grows
with the table.

## Alternatives considered

**Cursor / keyset pagination.** Correct under concurrent inserts, where offset paging can skip
or repeat rows as earlier rows shift. Rejected for now: the inventory is ordered by `id` and
the UI is a simple page-at-a-time browser, so the failure mode is a row appearing twice across
a page boundary during heavy inserts. Worth revisiting if this ever becomes an infinite scroll,
where the defect is far more visible.

**Leave it unbounded and document the limitation.** Zero work. Rejected: an unbounded list
endpoint on a table this project deliberately fills with thousands of rows is the first thing
anyone reviewing it would find.

**Return `total` only when asked.** Saves a `COUNT(*)` per request. Rejected as premature: the
count runs in parallel with the page query and neither showed up in the measurements.

## Consequences

- A default request serialises 50 rows instead of 6,002.
- The lab's count is one small request rather than two full-table fetches.
- The response shape changed from a bare array to an envelope, which is breaking. Acceptable:
  the only client is in this repository.
- Offset paging can skip or repeat a row if rows are inserted before the current offset between
  page loads. Accepted, and named here so it is a known limit rather than an oversight.

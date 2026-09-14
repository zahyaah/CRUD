# What changed, feature by feature

Every "why" below cites either a line in `pre-revamp`, a measurement in
[`measurements.json`](../loadtest/results/measurements.json), or an ADR. There is no prior
commit history to cite, because the project was two commits made three minutes apart.

## Create a product

| | Before | After |
|---|---|---|
| Id | Supplied by the client (`server.js:73`) | `AUTO_INCREMENT`, server-owned |
| Duplicate submit | Duplicate-key error returned as a generic 500 (`server.js:80-81`) | Coalesced onto the in-flight leader; every caller gets 201 |
| Validation | Browser only (`create_script.js:18-46`) | Zod at the API edge, same schema in the UI |
| Retry safety | None | `Idempotency-Key`, safe to retry indefinitely |

**Why.** The legacy baseline returned **500 for 75.0% of requests** under concurrent duplicate
submits, in all four runs (18,000 of 24,001). The product had in fact been created, so the
caller could not tell a duplicate from an outage and retrying was unsafe.
[ADR-0003](adr/0003-idempotency-keys.md), [ADR-0004](adr/0004-coalescing-over-rejection.md).

Taking the id away from the client is what makes this possible: as long as the client chose
the primary key, a resubmit was indistinguishable from a conflicting create by a different
user.

## Update a product

| | Before | After |
|---|---|---|
| Concurrency | Blind full-row overwrite (`server.js:89-103`) | `UPDATE … WHERE id=? AND version=?` |
| Lost update | Silent, last writer wins | 409 carrying `actualVersion` |
| Missing row | Indistinguishable from a conflict | 404, separated by one follow-up read |
| Dead validation | `req.body.length > 8`, never fired (`server.js:92`) | Zod, enforced |

**Why.** Two concurrent edits to the same product silently discarded one of them. The version
column turns that into a reportable conflict the UI can surface and the user can rebase onto.
[ADR-0005](adr/0005-optimistic-locking.md).

## List products

| | Before | After |
|---|---|---|
| Empty list | **410 Gone** (`server.js:48-49`) | 200 with an empty `items` array |
| Size | Unbounded `SELECT *` | `?limit&offset`, default 50, cap 200 |
| Shape | Bare array | `{items,total,limit,offset}` |

**Why.** 410 means the resource is permanently gone, not that a collection is empty; the
legacy server returned it on every empty-table read, confirmed at runtime. The bound came out
of the Step 9 quality pass, where the endpoint was returning all **6,002 rows** during load
testing. [ADR-0008](adr/0008-bounded-list-endpoint.md).

## Delete a product

Behaviour was already correct at `pre-revamp` (`server.js:107-122` checked `affectedRows`).
Now returns 204 rather than 200 with a message body, and the table name casing is consistent.

## Error handling

The same five-line handler appeared five times and collapsed every failure into
`{"Error": "Internal Server Error"}` (`server.js:46`, `:61`, `:81`, `:99`, `:114`). Replaced
with a typed `AppError` hierarchy and one Express error handler. Unclassified errors are
logged with their cause and still return a generic 500, so internals are not leaked.

## Database access

One `mysql.createConnection` (`server.js:21-26`) became a promise pool of 100. The old
`connect()` callback logged failures and returned (`server.js:28-34`), leaving a server that
accepted traffic and hung on every request. SQL moved out of the handlers into repositories,
which is what let the write path be tested without booting Express.

## The product shape

Hand-written in eight places across both tiers. Now declared once in `@warehouse/shared` and
imported by the API, the repository mapper and the React form. Adding a column is one edit,
and a miss is a compile error on both sides. [ADR-0001](adr/0001-typescript-migration.md).

## Frontend

Four static HTML pages with five vanilla scripts became a React SPA. Feedback moved from
fifteen `alert()` calls to inline field errors and live regions. The pages had zero `aria-*`
attributes; controls are now wired to their labels, hints and errors through generated ids.
Two of five stylesheets had a media query; the layout now holds from 390px up, in both colour
schemes. [ADR-0002](adr/0002-react-frontend.md).

The concurrency lab is new. It fires simultaneous duplicate creates from the browser and shows
the leader/waiter split and the resulting row count, which turns the k6 numbers into something
you can click.

## Dependencies

`morgan` was required at runtime but declared as a devDependency (`server.js:3` against
`package.json:18`), so a production install crashed on boot. It is gone, replaced by `pino`.
`chalk` was declared and never imported (`package.json:17`); removed. `mysql2` moved from the
vulnerable `^3.11.0` range to 3.24, and `react-router` from 6 to 7. Production dependencies
report zero advisories.

## Removed outright

- `server.js:125-136`, which called `document.createElement` inside Node and was unreachable
  because `express.static` at `:18` already served that path.
- `server.js:74-75`, commented-out validation.
- `delete_script.js:6`, a misspelled selector assigned to an unused variable.
- A `withTransaction` helper written during Step 5 and deleted the same day for having no call
  sites. The transaction boundary returned in Step 7 when the fencing defect required it.

# Warehouse

A product CRUD API and UI, built to be correct under concurrent duplicate writes.

The interesting part is `POST /products`. Fire the same request eight times at once and you
get eight `201`s and exactly one product: one caller does the work, the rest wait on it and
receive its response. The `/lab` route lets you do that from the browser and watch the split.

This started as a hackathon app (`git show pre-revamp`). What that looked like, and what
changed, is in [`docs/architecture-before.md`](docs/architecture-before.md) and
[`docs/change-narrative.md`](docs/change-narrative.md).

## Quick start

Needs Docker, Node 20+, and [k6](https://k6.io) for the load tests.

```bash
npm install
npm run db:up                      # MySQL 8.4 on port 3307, schema loaded
cp backend/.env.example backend/.env
npm run build
npm run dev                        # API on :3000, UI on :5173
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API and UI in watch mode |
| `npm run build` | Builds shared, then backend, then frontend |
| `npm test` | Integration tests against the running MySQL |
| `npm run typecheck` | Typechecks all three workspaces |
| `npm run db:up` / `db:down` | Start or destroy the database container |
| `npm run loadtest` | k6 duplicate-burst scenario against the API |

Tests talk to a real database. The guarantees under test are enforced by MySQL, so mocking the
driver would test nothing.

## Layout

```
shared/     Zod schemas and types both tiers compile against
backend/    Express 5 API: http → services → repositories → pool
frontend/   React 18 + Vite + TanStack Query
db/         schema.sql and the MySQL container
loadtest/   k6 scenarios, plus the pre-revamp server kept runnable as a baseline
docs/       architecture, change narrative, debugging notes, ADRs
```

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/products?limit&offset` | `{items,total,limit,offset}`. Default 50, cap 200 |
| `GET` | `/products/:id` | |
| `POST` | `/products` | Requires `Idempotency-Key`. Duplicates are coalesced |
| `PUT` | `/products/:id` | Requires `expectedVersion`. 409 carries `actualVersion` |
| `DELETE` | `/products/:id` | |
| `GET` | `/health` | Runs `SELECT 1` through the pool |
| `GET` | `/metrics` | Leader/waiter split, dedup rate, steals, fenced rollbacks |

Creating a product:

```bash
curl -X POST localhost:3000/products \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"Widget","description":"A widget","price":19.99,"category":"tools",
       "stockQuantity":5,"manufacturer":"Acme","releaseDate":"2024-01-15","rating":4.5}'
```

Send it twice with the same key and the second response carries `Idempotent-Coalesced: true`.

## How the write path works

Callers race to `INSERT` the idempotency key. The `PRIMARY KEY` picks exactly one winner, so
the database is the arbiter and the guarantee holds across any number of API instances. The
winner runs the work and records its response in the same transaction as a fenced ownership
check; everyone else polls that row and returns what it finds.

A leader heartbeats its lease while it works, so only a process that actually stopped running
loses the key. If one is displaced anyway, its work rolls back, because the ownership check
commits atomically with the insert. Getting that wrong cost 28 duplicate rows to find, and
leaving out the heartbeat turned the fix into a livelock:
[`docs/debugging-notes.md`](docs/debugging-notes.md).

## Numbers

Six 60-second runs at 400 req/s, every fourth request a duplicate of the previous three:

- **Zero duplicate rows across 143,689 requests**, counted in the database, not inferred from
  responses. Rows created equalled the unique-key count in every run.
- Zero responses outside 200/201. Zero lease steals, zero rollbacks, zero timeouts.
- p99 ranged 23.6-394.9ms, median 86.6ms. The tail is not stable and the range is the honest
  number.
- On the same workload the original server returned **500 for every duplicate**, which is 75%
  of requests, while their writes had in fact succeeded.

That 75% is the duplicate ratio the test injects, not something either system discovered. What
differs is what each does with those duplicates: one absorbs them, the other fails them.

Everything, including the runs that went badly, is in
[`loadtest/results/measurements.json`](loadtest/results/measurements.json). All of it was
measured on one laptop running k6, the API and MySQL together, so treat it as a comparison
between two designs rather than a capacity figure.

## Decisions

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-typescript-migration.md) | TypeScript, with one shared contract package |
| [0002](docs/adr/0002-react-frontend.md) | React SPA over static pages |
| [0003](docs/adr/0003-idempotency-keys.md) | Idempotency keys with a database unique constraint |
| [0004](docs/adr/0004-coalescing-over-rejection.md) | Coalesce duplicates instead of rejecting them |
| [0005](docs/adr/0005-optimistic-locking.md) | Optimistic locking with a version column |
| [0006](docs/adr/0006-transactional-fencing.md) | Fence a leader's work inside its transaction |
| [0007](docs/adr/0007-patterns-applied-and-rejected.md) | Two patterns applied, four rejected |
| [0008](docs/adr/0008-bounded-list-endpoint.md) | Bound the list endpoint |
| [0009](docs/adr/0009-key-identity.md) | Treat the idempotency key as an exact, opaque identifier |

## Known limits

- Offset paging can repeat a row across a page boundary during heavy concurrent inserts.
- The idempotency ledger has an `expires_at` but nothing prunes it yet.
- `/metrics` is unauthenticated and counters are per process.
- A waiter that exhausts its wait budget gets a 504 asking it to retry, so "no client retry
  logic" holds for the routine path, not for degraded mode.
- At-most-once covers work done through the supplied transaction. A side effect outside it
  would re-run when a lease is stolen or a failed key reclaimed.
- Tail latency varies widely run to run on a laptop shared with the load generator.

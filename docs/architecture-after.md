# Architecture after the revamp

## Stack

| Layer | What is there now |
|---|---|
| Workspaces | npm workspaces: `shared`, `backend`, `frontend` |
| Contract | `@warehouse/shared`: Zod schemas and types both tiers compile against |
| API | Express 5 + TypeScript, `strict` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| Data | MySQL 8.4 via `mysql2` 3.24 promise **pool**, raw parameterised SQL |
| Frontend | React 18 + Vite + TanStack Query + React Router 7 |
| Logging | `pino` / `pino-http`, structured JSON |
| Tests | Vitest against a real MySQL, 10 integration tests |
| Load | k6, with the original server kept runnable as a baseline |

## Layering

Each layer depends only on the one below it, so the write path can be exercised without an
HTTP server.

```
                    @warehouse/shared
              (Zod schemas + Product types)
                 ▲                     ▲
                 │                     │
  ┌──────────────┴──────────┐   ┌──────┴─────────────────┐
  │ frontend                │   │ backend                │
  │  routes/                │   │  http/routes  ← parse  │
  │  hooks/  (TanStack)     │   │  services/    ← policy │
  │  api/client.ts          │   │  repositories/← SQL    │
  └─────────┬───────────────┘   │  db/pool.ts            │
            │  fetch            └──────┬─────────────────┘
            └──────────────────────────┤
                                       ▼
                                 MySQL 8.4 (pool)
```

## The write path

`POST /products` is the only endpoint that runs through the coalescing service.

```
POST /products  + Idempotency-Key
   │
   ▼
productQuery / createProductInput  (Zod, at the edge)
   │
   ▼
runIdempotent(key, body, operation)
   │
   ├── INSERT idempotency_key ──► won the PRIMARY KEY race ──► LEADER
   │                                    │
   │                                    ▼
   │                          BEGIN
   │                            INSERT product
   │                            UPDATE idempotency_key
   │                              SET state='completed', response_body=…
   │                              WHERE key=? AND leader_token=?   ← fence
   │                            affectedRows = 0 ? ROLLBACK : COMMIT
   │
   └── ER_DUP_ENTRY ─────────► WAITER
                                  │  poll every ~15ms (jittered)
                                  ├── state='completed' → return stored response
                                  ├── state='failed'    → raise the leader's failure
                                  ├── lease expired     → steal, become leader
                                  └── budget exhausted  → 504, retry the same key
```

Correctness rests on the database, not on application coordination: the `PRIMARY KEY` picks
exactly one leader, and the lease predicate lives in the `WHERE` clause so two waiters cannot
both win a steal. The guarantee therefore survives any number of API instances.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/products?limit&offset` | Paged envelope `{items,total,limit,offset}`. Default 50, cap 200 |
| `GET` | `/products/:id` | 404 when absent |
| `POST` | `/products` | Requires `Idempotency-Key`. Coalesced. Server generates the id |
| `PUT` | `/products/:id` | Requires `expectedVersion`. 409 carries `actualVersion` |
| `DELETE` | `/products/:id` | 204, or 404 when absent |
| `GET` | `/health` | Verifies the pool answers `SELECT 1` |
| `GET` | `/metrics` | Leader/waiter split, dedup rate, steals, fenced rollbacks, timeouts |

Errors share one envelope, `{error:{code,message,details?}}`, and map to real status codes
instead of the single opaque 500 the old server returned.

## Schema

`product` gained `version` for optimistic locking plus `created_at` / `updated_at`, and moved
from a client-supplied `id` to `AUTO_INCREMENT`. `price` is `DECIMAL(10,2)` rather than a
float, with `CHECK` constraints on price and rating.

`idempotency_key` is the coalescing ledger: the key as `PRIMARY KEY`, a request fingerprint,
a `processing`/`completed`/`failed` state, the stored response, a `leader_token`, and a
millisecond-precision `lease_expires_at`.

Full DDL, including which parts are reconstructed, is in [`db/schema.sql`](../db/schema.sql).

## Frontend

Three routes: inventory with paging and conflict-aware editing, a create form, and the
concurrency lab. Forms validate with the server's own Zod schema, so the two cannot disagree
about what is valid. Labels, hints and errors are wired to controls through generated ids in
`Field.tsx`. The page holds its layout from 390px up, in both colour schemes.

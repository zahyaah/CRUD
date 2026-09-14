# Architecture at `pre-revamp` (1c8f121, 2024-08-12)

Every claim here cites a line in the tagged commit. Read it with
`git show pre-revamp:backend/server.js`.

## Stack

| Layer | What was there |
|---|---|
| Runtime | Node.js, Express `^4.19.2` |
| Data | MySQL via `mysql2` `^3.11.0`, callback API, a single connection (`server.js:21-26`) |
| Frontend | 4 hand-written HTML pages, 5 vanilla JS files, 5 CSS files. No build step |
| Config | `--env-file=.env` (`package.json:8`). No `.env`, no `.env.example`, no schema DDL |
| Tests / CI | None. `npm test` was the npm-init placeholder that exits 1 (`package.json:7`) |

1,060 lines of source. `create_style.css` at 141 lines outweighed the entire backend at 139.

## Data flow

Every request took the same shape, with no layering. Handler, validation, SQL and response all
lived inside one arrow function.

```
Browser (per-page vanilla JS)
   │  fetch()
   ▼
express.static  ──shadows──▶  [dead /product.html route, server.js:125-136]
   │
   ▼
app.<verb>("/products…")   handler + validation + SQL string, all inline
   │
   ▼
single mysql connection  ──▶  MySQL `PRODUCT`
```

No model, no repository, no service layer, no router module. `backend/server.js` was the
backend.

## Duplication

**The nine product fields were hand-written in eight places.** `server.js:73`, `:77-78`,
`:91`, `:95-96`, `create_script.js:7-15` and `:48-58`, `update_script.js:12-20` and `:28-38`,
`product_script.js:9-47`, `productid_script.js:34-42`. Adding one column meant eight
coordinated edits with no compiler to catch a miss.

**Accidental cross-page coupling.** `product_script.js:7` selected the generic
`document.querySelector("table")`, so the same script populated both `product.html`'s
`.tableContainer` and `update.html`'s `.updateTable`. It worked by coincidence; a second
`<table>` on either page would have broken it silently.

**The same 500 handler appeared five times**, which is why a duplicate-key violation and a
dropped connection were indistinguishable to the caller.

## Concurrency gaps

- **One connection, not a pool** (`:21-26`). Every request serialised through a single socket,
  and a dropped connection was unrecoverable because `connect()` only logged and returned
  (`:28-34`).
- **Client-supplied primary key with no idempotency** (`:72-85`). A duplicate submit hit a
  duplicate-key error that surfaced as a generic 500.
- **Blind full-row overwrite on PUT** (`:89-103`). No version check, so two concurrent edits
  meant the last writer silently won.

## Defects

Found by reading, then confirmed by running the server (see [`debugging-notes.md`](debugging-notes.md)):

| Location | Defect |
|---|---|
| `:28-34` | Connection failure logged and swallowed. The listener stayed up and every request hung forever |
| `:44` vs `:110` | `PRODUCT` and `product` used inconsistently. Harmless on macOS, fatal on Linux |
| `:48-49` | An empty product list returned **410 Gone** |
| `:92` | `req.body.length > 8` on a plain object. `undefined > 8` is always false, so the check never fired |
| `:74-75` | The same check, commented out, in the POST handler |
| `:125-136` | Called `document.createElement` inside Node. Unreachable anyway, since `express.static` at `:18` already served that path |
| `delete_script.js:6` | `querySelector("tableContainter")`: misspelled, missing the `.`, and never used |

Validation existed only in the browser (`create_script.js:18-46`) and was bypassed with one
`curl`.

## Frontend

Zero `aria-*` attributes across all four pages. Twenty hard-coded pixel widths. Two of five
stylesheets had any media query. Fifteen `alert()` calls were the entire feedback mechanism.
Scripts loaded in `<head>` with no `defer`.

## Dependencies

`morgan` was required at runtime (`server.js:3`, `:17`) but declared as a devDependency
(`package.json:18`), so `npm install --production` produced a crash on boot. `chalk` was
declared (`package.json:17`) and never imported.

# ADR-0002: Rebuild the frontend as a React SPA

## Status
Accepted

## Date
2026-09-14

## Context

The `pre-revamp` frontend was four hand-written HTML pages with five vanilla scripts. Measured
against the tagged commit:

- Zero `aria-*` attributes across all four pages.
- Fifteen `alert()` calls as the entire feedback mechanism.
- Twenty hard-coded pixel widths; two of five stylesheets had any media query.
- `product_script.js:7` selected the generic `document.querySelector("table")`, so one script
  populated two different pages by coincidence.
- Scripts loaded in `<head>` with no `defer`.

The flagship work is concurrency correctness, and the frontend had to be able to show it
rather than describe it.

## Decision

React 18 + Vite + TanStack Query + React Router 7, as a single-page app.

TanStack Query earns its place specifically here: it owns cache invalidation, in-flight
request de-duplication and retry policy, which is the part of the concurrency story that
reaches the UI. Mutation retries are configured off by default, because retrying a create is
only safe when it carries an idempotency key.

Forms validate with the server's Zod schema from `@warehouse/shared`, so client and server
cannot disagree about what is valid.

A third route, the concurrency lab, fires simultaneous duplicate creates from the browser and
shows the leader/waiter split with the resulting row count.

## Alternatives considered

**TypeScript + Vite with no framework.** Smallest bundle, closest to the original spirit.
Rejected: cache invalidation and in-flight de-duplication would be hand-rolled, and those are
exactly the parts that need to be airtight given what this project is meant to demonstrate.

**Next.js.** Server components and server actions are strong signals. Rejected: SSR adds
surface that does not serve a concurrency narrative and blurs where the idempotency boundary
sits. Most complexity for the least benefit here.

**Keep the multi-page HTML and patch the accessibility gaps.** Cheapest. Rejected: it leaves
the duplicated product shape in the UI, which [ADR-0001](0001-typescript-migration.md) exists
to remove.

## Consequences

- Verified in headless Chromium, not by inspection: ten simultaneous creates produce one
  leader, nine waiters and one product, with no console errors, and the layout holds at 390,
  768 and 1280px in both colour schemes.
- Two layout defects surfaced that reading the CSS would not have caught. Both are written up
  in [`debugging-notes.md`](../debugging-notes.md).
- Bundle is 345KB raw, 105KB gzipped. Heavy for a CRUD app, and the honest price of the
  framework choice. A no-framework build would be a fraction of it.
- The app now needs a build step, where the original was served as static files.

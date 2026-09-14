# ADR-0001: Migrate to TypeScript with a shared contract package

## Status
Accepted

## Date
2026-09-14

## Context

At `pre-revamp` the nine product fields were hand-written in eight places: `server.js:73`,
`:77-78`, `:91`, `:95-96`, `create_script.js:7-15` and `:48-58`, `update_script.js:12-20` and
`:28-38`, `product_script.js:9-47`, `productid_script.js:34-42`.

Adding a column meant eight coordinated edits across two tiers with nothing to catch a miss.
That is a countable defect surface, not a style complaint, and it is the concrete problem this
migration had to solve. A migration that produced typed files while leaving the shape declared
in eight places would have bought almost nothing.

Server-side validation did not exist. All of it lived in `create_script.js:18-46` and was
bypassed with one `curl`.

## Decision

Convert to TypeScript under `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, and extract the product contract into a `@warehouse/shared`
npm workspace that the API and the UI both compile against.

Zod owns the schema; the static types are inferred from it, so the runtime check and the
compile-time type cannot disagree.

Migration order followed the data layer first, then services, then HTTP, then the UI, because
the data layer has the cleanest types and everything above it depends on those.

## Alternatives considered

**Types duplicated per tier.** Simplest to wire up, no build ordering to manage. Rejected: it
reproduces the original defect in a form the compiler cannot see across the boundary. Two
copies drift.

**Generate types from the database schema.** Accurate by construction. Rejected: it types the
persistence shape, not the API shape, and the two differ deliberately here (camelCase over
the wire, `DECIMAL` arriving as a string, `expectedVersion` existing only on input).

**JSDoc type annotations on the existing JavaScript.** No build step. Rejected: it cannot
express the discriminated results and branded input types the write path relies on, and the
project is being rebuilt anyway.

## Consequences

- Adding a product column is one edit, and a miss is a compile error in both tiers.
- The React form validates with the server's schema, so the two cannot disagree about what is
  valid.
- The shared package needs building before its consumers. `npm run build` orders this.
- Dependency review during the migration surfaced two real problems: `morgan` was required at
  runtime but declared as a devDependency (`server.js:3` against `package.json:18`), and the
  `mysql2` range carried a high-severity advisory. Both fixed; production dependencies report
  zero advisories.

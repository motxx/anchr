# Typecheck README TypeScript code fences against the real @anchr/* surface

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

README code samples are the first thing a new user copies, but nothing
typechecks them: the front-page Customer sketch referenced
`createHttpOracleClient` long after issue 0095 deleted that factory (fixed as
issue 0203 by hand). The repo currently has 5 `ts` fences across `README.md`
(1) and `packages/sdk/README.md` (4), all importing from `@anchr/*`. A lint
that extracts these fences and runs `deno check` against the real exports
would catch README-vs-API drift in the harness instead of review.

## Rationale

- Issue 0203: stale `createHttpOracleClient` in `README.md` survived the 0095
  removal because no check covers prose code samples.
- Precedent for docs-checking lints exists: `lint:proof-schema-pages`
  (`scripts/check-proof-schema-pages.ts`).
- Samples already use placeholder values (`"npub1exampleoraclepubkey"`), so
  they can typecheck without network or secrets.

## Acceptance

- A gating lint extracts `ts` fences from `README.md` and
  `packages/*/README.md` and typechecks them against the workspace packages
  (fences may opt out with an explicit marker if truly illustrative).
- The lint is chained into `deno task lint:strict`.

## Verification

- The lint passes on the current tree.
- Re-introducing `createHttpOracleClient` into a README fence makes the lint
  fail. Expected outcome: non-zero exit naming the README and the missing
  symbol.

## Plan

- Add `scripts/lint-readme-typecheck.ts` (extract fences → temp module per
  fence → `deno check`), wire into `lint:strict`.

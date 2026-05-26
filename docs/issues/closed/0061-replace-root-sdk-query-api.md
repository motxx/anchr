# Replace root SDK query API

Created: 2026-05-24
Model: GPT-5 Codex
Completed: 2026-05-24

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0054

## Summary

Replace the root `@anchr/sdk` HTTP convenience client names that still expose
`query` vocabulary with paid-request vocabulary, or remove the app-owned HTTP
client from the root public surface if it is no longer part of the SDK's
primary Customer/Provider/Oracle contract.

## Rationale

Parent #0054 can no longer close while the root SDK exports query-shaped public
API names. Current references include:

- `packages/sdk/src/index.ts` exporting `QueryOptions`, `QueryResult`, and
  `QueryTimeoutError`.
- `packages/sdk/src/client.ts` exposing `anchr.query()`, `createTlsnQuery()`,
  `getQueryStatus()`, and `listOpenQueries()`.
- `packages/sdk/src/client-types.ts` exporting root client query result and
  summary types with `bounty` payload details.
- `packages/sdk/src/errors.ts` exporting `QueryTimeoutError`.

The Customer/Provider actor API already uses `customer.request()` and should
remain the primary integration path. Pre-1.0 replacements should delete the old
query-shaped API names rather than preserving aliases.

## Acceptance

- The root `@anchr/sdk` export surface no longer exports `QueryOptions`,
  `QueryResult`, `QueryTimeoutError`, or root client methods named with
  `query`.
- Any retained HTTP convenience client method and type names use request
  vocabulary, for example `request`, `RequestOptions`, `RequestResult`,
  `RequestTimeoutError`, `getRequestStatus`, and `listOpenRequests`.
- Root SDK tests and README examples use the retained public API names.
- Wire payload fields such as REST paths or response JSON keys remain unchanged
  only where they are external adapter contracts, not SDK API names.

## Verification

- No matches are expected:
  `rg -n "QueryOptions|QueryResult|QueryTimeoutError|anchr\\.query|createTlsnQuery|getQueryStatus|listOpenQueries|\\bquery\\(" packages/sdk/src/index.ts packages/sdk/src/client.ts packages/sdk/src/client-types.ts packages/sdk/src/errors.ts packages/sdk/README.md README.md`
- `deno task test:unit`

## Plan

- Decide whether the HTTP convenience client belongs on the root SDK surface or
  should be removed from root exports.
- Rename retained root client types, methods, errors, tests, and README
  examples to request vocabulary.
- Keep external REST payload details isolated inside the client implementation.

## Resolution

Implemented by updating:

- `packages/sdk/src/client.ts`
- `packages/sdk/src/client-types.ts`
- `packages/sdk/src/errors.ts`
- `packages/sdk/src/index.ts`
- `packages/sdk/src/index.test.ts`

Verified with:

- `rg -n "QueryOptions|QueryResult|QueryTimeoutError|PhotoQueryOptions|anchr\\.query|createTlsnQuery|getQueryStatus|listOpenQueries|\\bquery\\(" packages/sdk/src/index.ts packages/sdk/src/client.ts packages/sdk/src/client-types.ts packages/sdk/src/errors.ts packages/sdk/README.md README.md`
- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys packages/sdk/src/index.test.ts`
- `deno task test:unit`
- `deno task lint:strict`

Harness update:

- `packages/sdk/src/index.test.ts` now compiles against `RequestTimeoutError`
  from the root SDK export surface.

Review residuals:

- None

Follow-up:

- None

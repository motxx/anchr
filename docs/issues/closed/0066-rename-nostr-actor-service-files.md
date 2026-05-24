# Rename Nostr actor service files

Created: 2026-05-24
Model: GPT-5 Codex
Completed: 2026-05-24

## Priority

maintenance

## Dependencies

Depends on:
- 0062
- 0065

Blocks:
- 0048

## Summary

Rename the remaining Nostr adapter Customer and Provider workflow file names so
the internal SDK adapter layout uses the same actor vocabulary as the public
Nostr adapter API.

## Rationale

#0062 renamed the public `@anchr/sdk/adapters/nostr` requester, worker, and
query exports to Customer, Provider, and request vocabulary. #0065 then moved
the Oracle Nostr workflow binding under `packages/sdk/src/adapters/nostr/`.

After those changes, the Nostr adapter directory still contains
`requester-service.ts` and `worker-service.ts` next to `oracle-service.ts`.
Those file names are no longer public API, but they make the internal owner map
look like Requester/Worker are still the preferred SDK actor terms. Rename them
to match the Customer/Provider vocabulary already used by the exported symbols.

This issue should not change wire-compatible Nostr event names, NIP-90
terminology, JSON field names such as `requester_pubkey` or `worker_pubkey`, or
protocol helper names where changing them would break interoperability.

Relevant files:

- `packages/sdk/src/adapters/nostr/requester-service.ts`
- `packages/sdk/src/adapters/nostr/requester-service.test.ts`
- `packages/sdk/src/adapters/nostr/worker-service.ts`
- `packages/sdk/src/adapters/nostr/worker-service.test.ts`
- `packages/sdk/src/adapters/nostr/mod.ts`
- `packages/sdk/src/adapters/nostr/index.ts`

## Acceptance

- `packages/sdk/src/adapters/nostr/requester-service.ts` is renamed to a
  Customer-owned file name.
- `packages/sdk/src/adapters/nostr/worker-service.ts` is renamed to a
  Provider-owned file name.
- Matching test files and local imports use the new file names.
- Public `@anchr/sdk/adapters/nostr` exports remain Customer, Provider, and
  request-oriented.
- Wire-compatible Nostr protocol field names and event helper names are not
  renamed as part of this issue.

## Verification

- No files should exist:
  `test ! -e packages/sdk/src/adapters/nostr/requester-service.ts && test ! -e packages/sdk/src/adapters/nostr/worker-service.ts`
- No matches are expected:
  `rg -n "\\./(requester|worker)-service|requester-service|worker-service" packages/sdk/src/adapters/nostr`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Inspect the Nostr adapter barrel exports and tests before renaming files.
- Rename the implementation and test files without changing protocol wire
  vocabulary.
- Update imports and issue-specific negative checks so future cleanups do not
  reintroduce the old internal file names.

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/nostr/customer-service.ts`
- `packages/sdk/src/adapters/nostr/customer-service.test.ts`
- `packages/sdk/src/adapters/nostr/provider-service.ts`
- `packages/sdk/src/adapters/nostr/provider-service.test.ts`
- `packages/sdk/src/adapters/nostr/mod.ts`

Verified with:

- `test ! -e packages/sdk/src/adapters/nostr/requester-service.ts && test ! -e packages/sdk/src/adapters/nostr/worker-service.ts`
- `rg -n "\\./(requester|worker)-service|requester-service|worker-service" packages/sdk/src/adapters/nostr`
- `deno task test:unit`
- `deno task lint:strict`

Harness update:

- Existing unit tests were preserved under the renamed Customer and Provider
  service filenames; the issue-specific negative filename/import checks lock
  the internal actor-vocabulary cleanup.

Review residuals:

- None

Follow-up:

- None

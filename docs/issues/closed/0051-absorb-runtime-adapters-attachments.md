# Absorb runtime adapters attachments

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-23

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0050

Blocks:
- 0047

## Summary

Move runtime helpers, standard adapters, and attachment transport helpers into
SDK-owned modules instead of publishing them as separate Anchr packages.

## Rationale

#0046 classifies runtime helpers, standard Nostr/Cashu/storage adapters, and
Blossom attachment transport as SDK responsibilities or SDK internals. They
should be available through `@anchr/sdk/adapters`, `@anchr/sdk/attachments`, or
SDK-internal imports, not through standalone public packages.

Relevant current surfaces:

- `packages/core-runtime/`
- `packages/adapters/`
- `packages/blossom/`
- `packages/sdk/`
- `packages/bounty/src/infrastructure/attachment-store.ts`
- `packages/bounty/src/infrastructure/attachment-helpers.ts`

## Acceptance

- Standard Nostr, Cashu, storage, signer, and Blossom attachment helpers needed
  by SDK callers are exported from approved SDK subpaths.
- SDK-internal runtime helpers are no longer imported from a public
  `@anchr/core-runtime` package by packages that remain after the collapse.
- Package code no longer imports `@anchr/adapters`, `@anchr/blossom`, or
  `@anchr/core-runtime` as public Anchr package surfaces.
- Absorbed runtime, adapter, and Blossom package manifests are deleted when no
  references remain.

## Verification

- No matches are expected:
  `rg -n "@anchr/(adapters|blossom|core-runtime)" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:integration`

## Plan

- Move standard adapter exports into `packages/sdk/src/adapters/`.
- Move attachment transport helpers into `packages/sdk/src/attachments/`.
- Move runtime helpers used by SDK code into SDK internals or script-local code
  as appropriate.
- Rewrite package imports and tests, then delete absorbed package manifests and
  directories.

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/`
- `packages/sdk/src/attachments/`
- `packages/sdk/src/internal/runtime/`
- `packages/*/src/runtime/`
- `packages/bounty/src/infrastructure/blossom/client.ts`
- `deno.json`
- `Dockerfile`
- `e2e/helpers/process.ts`

Verified with:

- `rg -n "@anchr/(adapters|blossom|core-runtime)" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:integration`
- `deno task lint:strict`

Harness update:

- Existing SDK adapter and attachment tests moved with the absorbed code, and
  `lint:arch` plus `lint:dockerfile-workspace` now enforce the new workspace
  boundary.

Review residuals:

- None

Follow-up:

- None

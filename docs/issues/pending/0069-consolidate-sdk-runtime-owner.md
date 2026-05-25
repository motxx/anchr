# Consolidate SDK runtime owner

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Remove the duplicate `packages/sdk/src/proofs/runtime/` runtime compatibility
directory and make `packages/sdk/src/internal/runtime/` the single SDK runtime
owner. Proof modules should import the shared internal runtime helpers directly
instead of carrying proof-local copies of `spawn`, file-system helpers,
runtime-target detection, `moduleDir`, `which`, or logger exports.

## Rationale

The current layout has two runtime directories:

- `packages/sdk/src/internal/runtime/`
- `packages/sdk/src/proofs/runtime/`

That is surprising when scanning the tree. The proof-local directory is not a
proof-specific port; its files are copies or simple re-exports of generic SDK
runtime compatibility helpers. Under the repository's single-purpose design
rule, generic runtime compatibility should have one owner.

Known current imports include:

- `packages/sdk/src/proofs/ai-content-check.ts`
- `packages/sdk/src/proofs/c2pa-validation.ts`
- `packages/sdk/src/proofs/proofmode-validation.ts`
- `packages/sdk/src/proofs/tlsn-validation.ts`
- `packages/sdk/src/proofs/c2pa-validation.test.ts`
- `packages/sdk/src/attachments/exif-strip-helpers.ts`

## Acceptance

- `packages/sdk/src/proofs/runtime/` no longer exists.
- Proof and attachment code that needs runtime helpers imports from
  `packages/sdk/src/internal/runtime/`.
- `packages/sdk/src/internal/runtime/` is the only `runtime` directory under
  `packages/sdk/src/`.
- No duplicate runtime compatibility helpers remain under proof-specific
  directories.
- No new proof-specific runtime facade is introduced unless it owns a real
  proof-domain port rather than generic process, file-system, environment,
  logger, or executable lookup helpers.

## Verification

- No matches are expected:
  `test ! -d packages/sdk/src/proofs/runtime`
- Only `packages/sdk/src/internal/runtime/` is expected:
  `find packages/sdk/src -type d -name runtime -print`
- No matches are expected:
  `rg -n "proofs/runtime|\\.\\/runtime\\/|\\.\\/runtime\\.ts|from \"\\.\\/runtime" packages/sdk/src/proofs packages/sdk/src/attachments`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Update proof and attachment imports to reference `../internal/runtime/...` or
  `../../internal/runtime/...` as appropriate.
- Delete `packages/sdk/src/proofs/runtime/`.
- Keep `packages/sdk/src/internal/runtime/` as the SDK's only runtime
  compatibility owner.
- Run the focused directory/import checks before unit tests and strict lint.

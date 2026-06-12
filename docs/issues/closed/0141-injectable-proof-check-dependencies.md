# Injectable dependencies for proof checks

Created: 2026-06-12
Model: Claude Fable 5 (claude-fable-5)
Completed: 2026-06-13

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Proof checks reach environment-dependent state through module-level
singletons, blocking per-test isolation and host composition:

1. `packages/sdk/src/proofs/c2pa-validation.ts` caches `which("c2patool")`
   in module-level mutable state at first call; tests cannot force
   tool-available/unavailable states independently.
2. `packages/sdk/src/proofs/verification/checks/photo-integrity.ts` reads
   integrity records through the global store (`getIntegrity`) with no
   injection seam, so a host composing its own `createIntegrityStore()` is
   silently ignored, while sibling dependencies are already injectable via
   `VerifyProofOptions`.
3. `photo-integrity.ts` also owns the generic `fetchAttachmentData` helper
   consumed by the ai-content check through a dummy out-param; attachment
   retrieval belongs to `packages/sdk/src/attachments/`.

## Rationale

- Found by the `arch-lint-llm` review (L002 x2, L007) on 2026-06-12.
  Pre-existing structure.

## Acceptance

- Tool path and integrity store are injectable (option or port) with the
  current behavior as default.
- `fetchAttachmentData` lives in `attachments/` with a result-shaped return,
  and both checks consume it from there.

## Verification

- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Add the two seams with defaults, relocate the helper, update call sites.

## Resolution

Implemented by updating:

- `packages/sdk/src/proofs/c2pa-validation.ts` — `validateC2pa` /
  `isC2paAvailable` accept `C2paToolOptions.toolPath` (path or `null` to
  force unavailable); PATH discovery stays the cached default
- `packages/sdk/src/proofs/verification/checks/types.ts` —
  `VerifyProofOptions.integrityStore` seam;
  `checks/photo-integrity.ts` consumes the injected store and falls back to
  `getDefaultIntegrityStore()` (`proofs/integrity-store.ts`)
- `packages/sdk/src/attachments/fetch-attachment.ts` — `fetchAttachmentData`
  relocated from `photo-integrity.ts` with a result-shaped return
  (`{ok,data}|{ok,reason}`); `checks/ai-content.ts` and
  `checks/photo-integrity.ts` consume it from `attachments/`

Verified with:

- `deno task test:unit` (toolPath forcing test; injected-integrity-store
  test in `verifier-standalone.test.ts`)
- `deno task lint:strict`

Harness update:

- The injected-store and toolPath tests lock both seams; service-locator
  findings remain owned by `/arch-lint-llm` (L002).

Review residuals:

- None

Follow-up:

- None

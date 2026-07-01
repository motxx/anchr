# Fix the proofs/ composition-root inversion around schema bundles

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

The schema-bundle composition root is physically misplaced inside the layer it
composes. `proofs/verification/checks/registry.ts` imports the bundle
factories one level *up* (`proofs/*-schema.ts`), and those factories import
the checks back *down* (`proofs/verification/checks/*`), while the individual
checks also reach up into top-level validation engines. There is no file-level
cycle, but the direction tangles at directory level: the registry (topmost
wiring) sits at the bottom, and bundle definitions sit above the checks they
compose. This blocks a directory-granularity cycle rule (0201) and makes the
layering unreadable.

## Rationale

- Down edges: `proofs/c2pa-image-schema.ts:5-9`, `tlsn-schema.ts:4-7`,
  `generic-media-schema.ts:2-3`, `mod.ts:9` import `verification/`.
- Up edges: `verification/checks/registry.ts:2-4` imports
  `../../c2pa-image-schema.ts`, `../../generic-media-schema.ts`,
  `../../tlsn-schema.ts` (closes the directory-level tangle);
  `verification/verifier.ts:22-23` imports `../../schema.ts` and
  `../generic-media-schema.ts`; `verification/checks/photo-integrity.ts:18,22`
  imports `../../c2pa-validation.ts`, `../../integrity-store.ts`;
  `verification/checks/tlsn.ts:3,8-9` imports `../../tlsn-validation.ts`,
  `../../tlsn-types.ts`.
- Coherent one-way direction would be: `values.ts`/`schema-options.ts` (leaf)
  ← `contract.ts`/`checks/types.ts` ← individual checks ← schema bundles ←
  registry ← verifier.

## Acceptance

- Bundle definitions and their registration live in one composition module
  positioned above the checks they compose; `verification/checks/` contains no
  import that reaches up into `proofs/` top-level schema or validation modules.
- The import direction across `proofs/` is one-way (leaves → checks → bundles
  → registry → verifier).

## Verification

- `rg "\.\./\.\./" packages/sdk/src/proofs/verification/checks` returns no
  matches that resolve to `proofs/*-schema.ts` or top-level validation
  modules (no matches expected after the move).
- `deno task lint:strict` and `deno task test:unit` pass; if 0201's cycle
  check lands first, it passes at directory granularity.

## Plan

- Move the `*-schema.ts` bundle factories plus the registration entry point
  into one composition root under `proofs/`.
- Retarget check imports so evidence engines are leaves relative to checks.

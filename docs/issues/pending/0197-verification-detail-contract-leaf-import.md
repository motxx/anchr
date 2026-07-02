# Import VerificationDetail from the contract leaf, not the proofs barrel

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

The request domain imports `VerificationDetail` from the `proofs/mod.ts`
god-barrel, which `export *`s every proof module (including server-only,
non-portable modules). The request domain's type graph therefore points at the
entire proofs feature surface; it survives only because the imports are
`import type`. `docs/architecture.md` says `proofs/verification/contract.ts`
owns the type.

## Rationale

- `packages/sdk/src/requests/domain/types.ts` (~line 6),
  `query-aggregate.ts` (~line 2), `oracle-types.ts` (~line 4),
  `requests/application/query-verification.ts` (~line 3) import
  `VerificationDetail` from `../../proofs/mod.ts`.
- Non-portable modules re-exported by the barrel:
  `tlsn-validation.ts`, `c2pa-validation.ts`, `proofmode-validation.ts`.

## Acceptance

- All four sites import `VerificationDetail` from
  `proofs/verification/contract.ts` directly.

## Verification

- `rg "from .*proofs/mod" packages/sdk/src/requests` returns no
  `VerificationDetail` imports.
- `deno task lint:strict` passes.

## Plan

- Repoint the four `import type` sites to the contract leaf.

# Split payments/ into Payment Lock and FROST signing owners

Created: 2026-06-10
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0109

Blocks:
- None

## Summary

`packages/sdk/src/payments/` (≈2.6k lines) bundles two subsystems: Cashu
HTLC Payment Lock escrow and FROST threshold signing. Split them into two
single-purpose owners, make `requests/application/*` depend on ports rather
than the concrete `payments/mod.ts` barrel, and consolidate the two FROST
coordinators' shared round orchestration. Decide `FrostSignaturePort`
(`requests/application/ports.ts`): wire it to the real signing coordinator or
delete it — today it has no production implementation and is exercised only
by injected test doubles on the p2pk_frost release path.

## Rationale

Single-purpose design gate in `CLAUDE.md`. `payments/mod.ts` re-exports 15
files wholesale; application-layer files import the concrete barrel
(`query-service-deps.ts`, `escrow-flow-methods.ts`,
`verification-orchestration.ts`), inverting the port direction. Depends on
#0109 so the FROST surface is final before the split.

## Acceptance

- Two directories (or clearly separated modules) with one-sentence owner
  responsibilities; no wholesale `export *` barrel spanning both.
- `requests/application/*` imports application ports, not payment concretes.
- `FrostSignaturePort` is either implemented by the signing coordinator or
  deleted with its dead branches.

## Verification

- `deno task lint:arch`
- `deno task test:all` and `deno task test:e2e:frost`

## Plan

- Resolve after the lifecycle unification queue (0104-0109) lands.

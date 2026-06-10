# Split payments/ into Payment Lock and FROST signing owners

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

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

## Resolution

Implemented by updating:

- `packages/sdk/src/payments/cashu/` — Payment Lock owner: escrow, wallet,
  HTLC options, escrow providers (incl. the P2PK frost-escrow provider,
  which is a Cashu lock variant), wallet/preimage stores.
- `packages/sdk/src/payments/frost/` — threshold-signing owner: CLI,
  config, both coordinators (kept separate: in-memory DKG session relay vs
  HTTP peer round orchestration are distinct responsibilities), signer,
  types, and the new `frost-signature-adapter.ts`.
- `payments/mod.ts` — explicit grouped re-exports; the public
  `@anchr/sdk/payments` subpath and symbols are unchanged.
- `requests/application/ports.ts` now owns `PreimageStore`/`PreimageEntry`
  (the old `payments/preimage-port.ts` is deleted) and the reshaped
  `FrostSignaturePort.requestSignature(query, result, blossomKeys?)`;
  no application file imports the payments barrel anymore.
- `FrostSignaturePort` is WIRED: `createFrostSignatureAdapter(nodeConfig)`
  delegates to the real `coordinateSigning`, forwarding the verification
  requirement/input that each peer independently re-checks; the old
  `(groupPubkey, message)` shape could never drive a real signature and
  was reshaped rather than aliased. This also unifies the application and
  Nostr signing-message formats.
- `scripts/arch-lint.ts` E026 allowlist updated (payments barrel allowance
  removed).

Verified with:

- `deno task check`, `deno task test:unit`, `deno task lint:strict`,
  `deno task test:e2e:protocol`, `deno task test:all`
- The relocated real-binary FROST DKG test now resolves the repo root and
  runs (previously silently skipped); it passes.

Harness update:

- arch-lint E026 now denies the application→payments-barrel edge it used
  to allow; the new adapter has a unit test for the below-threshold path.

Review residuals:

- None

Follow-up:

- None

# Wire or delete the production-dead payments escrow factories

Created: 2026-07-04
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Three payments factories have no consumer outside their own unit tests:
`createCashuEscrowProvider` (`payments/cashu/cashu-escrow-provider.ts`),
`createFrostSigner` (`payments/frost/frost-signer.ts`), and
`createFrostSignatureAdapter` (`payments/frost/frost-signature-adapter.ts`).
They are the constructors for escrow/signing ports that production never
wires: the settlement paths exercised by regtest/frost e2e go through
`adapters/cashu.ts` and `payments/cashu/frost-escrow-provider.ts` directly,
and the attack e2e suites use `createMockEscrowProvider` from `testing/`.
Decide per factory: wire it into the production composition (the option
consistent with the 0190 direction of driving the facades through the
`requests/` aggregate), or delete it and its tests outright per the pre-1.0
versioning policy.

## Rationale

- 2026-07-04 repo-wide dead-code sweep (0241): each factory's only
  importers are its own `*.test.ts` and the `payments/*/mod.ts` barrel.
- 0190 records that the canonical lifecycle (whose `ServiceDeps` escrow
  port these factories would implement) has no production consumer.
- 0196 owns consolidating the two Cashu HTLC implementations
  (`adapters/cashu.ts` vs `payments/cashu/cashu-escrow.ts`); the fate of
  `createCashuEscrowProvider` should be decided together with that
  consolidation, not before it.

## Acceptance

- For each of the three factories: it is constructed on a production code
  path (composition root, facade, or example), or it is deleted together
  with its unit tests and barrel exports.
- The decision is consistent with the 0190 lifecycle-owner decision and
  the 0196 HTLC consolidation.

## Verification

- If wiring: an e2e or integration test drives the factory through the
  production path.
- If deleting: `rg "createCashuEscrowProvider|createFrostSigner\b|createFrostSignatureAdapter" packages/`
  returns no matches, and `deno task test:all` passes.

## Plan

- Resolve after (or together with) 0190 and 0196.
- Compare the port surfaces the factories implement with what the live
  settlement paths actually consume; wire or delete accordingly.

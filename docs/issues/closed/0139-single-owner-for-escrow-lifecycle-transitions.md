# Single owner for escrow lifecycle transitions

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

The escrow lifecycle state machine is implemented twice with drifted bodies:
the domain transition functions in
`packages/sdk/src/requests/domain/query-aggregate.ts` (with
`query-transitions.ts`) and the application `do*` re-implementations in
`packages/sdk/src/requests/application/escrow-flow-methods.ts` (with the
`ESCROW_TRANSITIONS` table in `query-escrow-validation.ts`). Drift is already
concrete: domain `addOffer` runs `validateOfferInfo` while application
`doRecordOffer` appends unvalidated offers, and the application transition
table omits the `expired` targets the domain table includes.

## Rationale

- Found by the `arch-lint-llm` review (L003, duplicated state machine) on
  2026-06-12. Pre-existing structure.
- Two owners of transition + validation rules guarantee future divergence;
  the offer-validation gap is already a behavioral difference.

## Acceptance

- One module owns escrow transition and validation rules; the application
  methods delegate to it.
- The parallel transition table is deleted.
- Offer validation applies on the production path.

## Verification

- `deno task test:unit` and `deno task test:integration`
- No matches are expected: `rg "ESCROW_TRANSITIONS" packages/sdk/src/requests/application/query-escrow-validation.ts`

## Plan

- Re-read both implementations and route the `do*` methods through the domain
  aggregate's transition functions, keeping store I/O in the application
  layer.

## Resolution

Implemented by updating:

- `packages/sdk/src/requests/application/escrow-flow-methods.ts` — every
  `do*` method delegates transitions to the domain aggregate (`addOffer`,
  `selectProvider`, `beginWork`, `recordResult`, `completeVerification`);
  the application layer keeps store I/O, escrow-provider verification, and
  settlement orchestration
- `packages/sdk/src/requests/application/query-escrow-validation.ts` — the
  parallel `ESCROW_TRANSITIONS` table and `validateEscrowTransition` are
  deleted; `query-transitions.ts` is the single owner
- Offer validation (`validateOfferInfo`) now applies on the production path
  via the domain `addOffer`

Verified with:

- `deno task test:unit`, `deno task test:integration`,
  `deno task test:e2e:protocol`
- `rg "ESCROW_TRANSITIONS" packages/sdk/src/requests/application/query-escrow-validation.ts`
  returns nothing

Harness update:

- Duplicated-state-machine findings are owned by the `/arch-lint-llm`
  semantic review (L003); the existing transition unit tests now exercise the
  single owner.

Review residuals:

- None

Follow-up:

- None

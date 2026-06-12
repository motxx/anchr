# Single owner for escrow lifecycle transitions

Created: 2026-06-12
Model: Claude Fable 5 (claude-fable-5)

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

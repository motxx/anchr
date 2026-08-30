# Promote the Settlement Decision Rules to a drift-locked invariant

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0255

## Summary

The threat model's "Settlement Decision Rules" section calls collapsing
spendability / clean-settlement / audit decisions "security-sensitive" (it can
strand Provider funds or hide release anomalies), but it carries no `INV-NN`,
so `lint:invariants` requires neither a test nor a lock hash — and no test
currently covers the separation. The one settlement rule the threat model flags
as fund-stranding is the only one not drift-locked or test-required.

## Rationale

- `docs/threat-model.md`: "Settlement Decision Rules" section has no `INV-NN`.
- Grep for `spendable` / `clean-settlement` / settlement-decision across tests
  finds no coverage of the separation.
- Lock file: `docs/threat-model.lock.json`.

## Acceptance

- The settlement-decision separation is expressed as a numbered invariant with
  a matching test and a `docs/threat-model.lock.json` hash entry, or an
  explicit decision is recorded in the threat model that it is not an invariant.

## Verification

- `deno task lint:invariants` passes with the new `INV-NN` present in doc,
  lock, and a referencing test.

## Plan

- Assign an `INV-NN`; add tests that a policy / query_id / request_event_id
  mismatch does not suppress redeem of a spendable Provider-bound token, and
  the converse.
- Add the lock hash entry.

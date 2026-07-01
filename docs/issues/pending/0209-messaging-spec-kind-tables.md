# Reconcile the messaging.md kind tables and completion-feedback contradiction

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

`specs/messaging.md` has two kind tables covering disjoint kind sets, kind
30103 (Oracle Attestation) has no owner row despite being a documented wire
event, and the summary table advertises "completion" as a kind-7000 purpose
that a later section explicitly excludes from the v0 profile. A wire-format spec
must unambiguously enumerate kinds, owners, and profile membership.

## Rationale

- `specs/messaging.md`: Event Kinds table (~49-54, lists 5300/6300/7000/30103,
  omits kind 4 and 30088) vs Canonical Implementation Owners (~38-45, lists
  5300/6300/7000/kind-4/30088, omits 30103).
- Kind 30103 is implemented in
  `packages/sdk/src/adapters/nostr/events/oracle-attestation.ts` (not
  `@anchr/protocol/events`).
- Completion contradiction: ~line 53 (table) vs ~264-274 ("Completion Feedback
  Boundary … excluded from v0").

## Acceptance

- One authoritative kind list with owners (a 30103 row naming the SDK nostr
  adapter as owner); the completion entry reflects that it is out of the v0
  profile (or is qualified as SDK-local).

## Verification

- The two tables are reconciled into one; every documented kind has an owner;
  no internal completion contradiction remains.

## Plan

- Merge the tables, add the 30103 owner row, fix the completion entry.

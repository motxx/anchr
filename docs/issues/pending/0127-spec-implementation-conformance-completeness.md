# Spec ↔ implementation conformance and completeness

Created: 2026-06-11
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Tracking issue for the spec/implementation conformance findings beyond the
relay-Oracle cluster (0116): an unenforced `s`-tag rule, an undocumented wire
kind, an over-permissive offer parser, the missing wire-version marker, an
unpinned token serialization version, an ambiguous locktime field name, and
spec-completeness gaps for an independent implementer.

## Rationale

From the 2026-06-11 production-readiness audit §2.6:

- **SPEC-04** — the `s`-tag vs content `schema` "content wins" rule is
  unenforced; `parseQueryRequestEvent` never reads the `s` tag
  (`packages/protocol/src/events.ts:106-148`, `specs/proof-schemas.md:80-83`).
- **SPEC-05** — kind 30103 (Oracle Attestation) has a builder/parser/tests but
  no spec (`packages/protocol/src/nostr.ts:35`;
  `rg -n '30103|attestation' specs/` returns nothing).
- **SPEC-06** — `parseOfferFeedbackEvent` does not bind the offer to the request
  `e`-tag / customer `p`-tag (`packages/protocol/src/events.ts:183-208`).
- **SPEC-07** — no wire-contract version marker in the v0 protocol; propose a
  minimal `["v","0"]` tag + non-fatal parser check.
- **SPEC-08** — Cashu token serialization version is unpinned
  (`packages/sdk/src/payments/cashu/cashu-escrow-helpers.ts:30-32`).
- **SPEC-09** — `locktime_seconds` is absolute Unix seconds on the wire but
  "offset from now" in `Payment` (`packages/protocol/src/types.ts:15-19`).
- **SPEC-10** — rejection semantics, event ordering, and schema-namespace
  process are under-specified for an independent implementer.

## Acceptance

- Each finding is either resolved (parser/test/spec edit) or explicitly recorded
  as accepted with a rationale in the relevant spec.
- The wire-version marker decision (SPEC-07) is made and, if adopted, present in
  the four protocol builders + parsers with documented rejection semantics.

## Verification

- `deno task test:unit` (new `events.test.ts` cases for the version marker,
  `s`-tag rule, and offer binding as applicable).
- Expected `rg -n 30103 specs/` returns a match once kind 30103 is documented.
- `deno task lint:strict`

## Plan

- Re-read the specs and protocol builders/parsers; split with `make-issues`
  if the wire-version marker (SPEC-07) becomes its own change.
- Apply the low-risk doc/spec edits (SPEC-05, SPEC-09, SPEC-10) directly.

## Progress

- 2026-06-11: **SPEC-05 resolved** in the protocol/sdk role-separation pass.
  `specs/messaging.md` now documents kind 30103 (Oracle Attestation): the
  Event Kinds table row, the event shape, the `OracleAttestationPayload`
  fields, the addressable-event (`d` = `query_id`) semantics, its
  public/plaintext nature, and the ignore-on-parse-failure rejection rule.
  Remaining findings SPEC-04, SPEC-06, SPEC-07, SPEC-08, SPEC-09, SPEC-10 stay
  open under this issue.

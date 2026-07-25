# Decide whether schema verdicts belong in public attestation details

Created: 2026-07-07
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`buildOracleAttestationEvent`
(`packages/sdk/src/adapters/nostr/events/oracle-attestation.ts`) serializes
`attestation.schema_verdict` verbatim into the plaintext `details` field of
the public kind 30103 attestation event. TLSN verdicts can carry revealed
transcript data (`revealed_body`,
`packages/sdk/src/proofs/tlsn-validation.ts`), so whatever the customer chose
to reveal to the Oracle becomes public and irreversible on Nostr relays. The
threat model classifies this as the "Verdict content exposure" risk with
"reveal only minimal transcript ranges" as the only mitigation. Decide the
wire contract: keep `details` fully public (attestations are meant to be
publicly re-checkable), make verdict inclusion opt-in per query, or strip
verdict payloads from the public event and deliver them customer-only next to
the proof artifacts.

## Rationale

- Raised by a Codex review on PR #212 against
  `docs/threat-model.md` ("Trust surface: Attestation publication"): the doc
  and the code must make the same privacy claim, and today the code publishes
  verdict contents.
- Public re-verifiability is a stated property of attestations (anyone can
  check the Oracle's signature and reproduce deterministic checks) — a
  decision to strip `details` must say what remains publicly checkable.
- Wire-format change territory: kind 30103 payload shape is part of the
  `@anchr/protocol` contract surface (`specs/`), so the decision may need a
  spec edit, not only SDK changes.

## Acceptance

- A decision is recorded (ADR if it meets the ADR bar, otherwise the spec or
  threat model states the contract) for what the public `details` field may
  contain.
- Code, spec, and the threat-model "Attestation publication" section make the
  same claim about verdict visibility.

## Verification

- Unknown until investigation

## Plan

- Enumerate what each schema's verdict can contain (TLSN, C2PA, generic
  media) and which parts are needed for public re-verification.
- Decide public / opt-in / customer-only, then align
  `buildOracleAttestationEvent`, the spec, and the threat model in one change.

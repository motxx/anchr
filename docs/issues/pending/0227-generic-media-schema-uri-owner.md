# Give the generic-media fallback schema URI one identity owner

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Proof-schema identity is owned by `@anchr/protocol/schema` (`ProofSchema` with
`TlsnV1` and `C2paImageV1`), but the verifier's default/fallback schema is a
string literal defined outside that owner:
`GenericMediaSchemaUri = "https://anchr-spec.org/spec/proof/photo/v1"` in the
SDK. The default schema every requirement falls back to is therefore not part
of the wire-contract package — a fourth, informal identity source (after
protocol schema, root SDK schema registry, and the bundle modules), with
interoperability implications for other implementations that only read
`specs/` + `@anchr/protocol`.

## Rationale

- `packages/sdk/src/proofs/generic-media-schema.ts:5` defines the literal;
  `proofs/verification/verifier.ts:23,34` uses it as the fallback
  (`requirement.schema ?? GenericMediaSchemaUri`).
- `packages/protocol/src/schema.ts:15-17` enumerates only `TlsnV1` and
  `C2paImageV1`.
- `docs/architecture.md` ("Evidence contract"): protocol owns schema URI
  identifiers; SDK owns dispatch/registration.

## Acceptance

- A recorded decision: the generic-media URI joins the protocol schema
  identifiers (and `specs/` if it is part of the interoperable contract), or
  the fallback is documented as SDK-owned default behavior with the rationale
  stated where the literal is defined.
- Either way the URI has exactly one defining site.

## Verification

- `rg "anchr-spec.org/spec/proof/photo/v1" packages` shows one defining site
  (plus imports); protocol/spec docs and code agree on who owns the fallback.

## Plan

- Decide protocol-owned vs SDK-default; move or document the literal
  accordingly.

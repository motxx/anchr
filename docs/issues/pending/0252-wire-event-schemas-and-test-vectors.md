# Publish machine-readable wire event schemas and test vectors

Created: 2026-07-26
Model: Claude Opus 5

## Priority

feature

## Dependencies

Depends on:
- 0247
- 0248

Blocks:
- None

## Summary

The wire contract is currently owned only by TypeScript parsers in
`@anchr/protocol`. A compatible implementation in another language has to
read TypeScript to learn the event shapes. Publish JSON Schemas and test
vectors for every wire event under `specs/`, served through the existing
spec-site (anchr-spec.org, which today lists only the two proof-schema
pages in `spec-site/schemas.json`), and pin the TypeScript parsers to the
schemas with conformance tests so the two cannot drift.

## Rationale

- Precedent: Cashu NUTs ship per-NUT test vectors; the DLC specs ship
  message test vectors. Interoperability came from small shared wire
  artifacts, not shared SDKs.
- Scope limit: schemas describe structure only. Signing (NIP-01 id
  computation), NIP-44 encryption, rejection rules, and transition validity
  stay in the executable parsers — the schema does not replace them, and the
  wire stays NIP-01 JSON (no alternative encodings).
- Sequencing: 0247 consolidates event ownership into protocol and 0248
  settles the release-material payload shape; publishing before those lands
  would freeze shapes that are about to change.
- `docs/issues/pending/0209-messaging-spec-kind-tables.md` covers the human-
  readable kind tables; this issue covers the machine-readable artifacts.

## Acceptance

- Every event type built/parsed by `@anchr/protocol` has a JSON Schema and
  at least one valid and one invalid test vector under `specs/`.
- A conformance test suite feeds the vectors through the TypeScript parsers:
  valid vectors parse, invalid vectors are rejected, and schema-validity
  matches parser acceptance for every vector.
- The spec-site lists the schemas so they are fetchable at stable URLs.

## Verification

- The conformance suite runs in `deno task test:unit` (or a dedicated task
  wired into `test:all`) and fails when a parser and its schema diverge
  (verified once by mutating a schema field locally, then reverting).

## Plan

- Generate or hand-write schemas next to the specs; add the vector-driven
  conformance test; register pages in `spec-site/schemas.json`.

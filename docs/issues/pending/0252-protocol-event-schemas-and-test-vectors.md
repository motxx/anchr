# Publish JSON Schemas and test vectors for protocol events

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

The protocol message formats are currently defined only by TypeScript parsers in
`@anchr/protocol`. A compatible implementation in another language has to
read TypeScript to learn the event formats. Publish JSON Schemas and test
vectors for every protocol event under `specs/`, served through the existing
spec-site (anchr-spec.org, which today lists only the two Proof Schema
pages in `spec-site/schemas.json`), and pin the TypeScript parsers to the
JSON Schemas with conformance tests so the two cannot drift.

## Rationale

- Precedent: Cashu NUTs ship per-NUT test vectors; the DLC specs ship
  message test vectors. Interoperability came from small shared protocol
  artifacts, not shared SDKs.
- Scope limit: JSON Schemas describe structure only. Signing (NIP-01 id
  computation), NIP-44 encryption, rejection rules, and transition validity
  stay in the executable parsers — a JSON Schema does not replace them, and
  the messages stay NIP-01 JSON (no alternative encodings).
- Sequencing: 0247 consolidates event ownership into protocol and 0248
  settles the Release Material payload format; publishing before those lands
  would freeze shapes that are about to change.
- `docs/issues/pending/0209-messaging-spec-kind-tables.md` covers the human-
  readable kind tables; this issue covers the machine-readable artifacts.

## Acceptance

- Every event type built/parsed by `@anchr/protocol` has a JSON Schema and
  at least one valid and one invalid test vector under `specs/`.
- JSON Schemas use Draft 2020-12 and live at
  `specs/messages/<message-name>/v<version>/schema.json`.
- Every JSON Schema declares
  `"$schema": "https://json-schema.org/draft/2020-12/schema"` and a
  retrievable `$id` of
  `https://anchr-spec.org/spec/message/<message-name>/v<version>/schema.json`.
  Published schema URLs include an explicit version; no mutable `latest` URL
  is provided.
- Every JSON Schema requires the root integer field `version`, with `0` as its only
  accepted value; Anchr events do not use a `v` tag for this purpose.
- Each JSON format owns its version independently; no Anchr-wide version change
  is required when one format changes.
- Every object whose fields are defined by Anchr rejects unknown fields. Adding
  an Anchr field requires advancing that JSON format's version. This rule does
  not close the contents of opaque values whose shape is defined by a selected
  Proof Schema, such as proof data or verifier details.
- Version 0 defines no optional-extension field or capability negotiation.
  Future optional extensions require a separate protocol decision that states
  how a receiver distinguishes an extension it may ignore from one it must
  understand.
- A conformance test suite feeds the vectors through both layers and records
  them separately: valid vectors must satisfy their JSON Schema and parse; each
  invalid vector declares whether JSON Schema validation or the parser must
  reject it — a structurally valid vector may still be
  parser-rejected (signing, encryption, transition rules).
- The spec-site lists the JSON Schemas so they are fetchable at stable URLs.

## Requirement traceability

| Requirement | Verification |
| --- | --- |
| Every protocol event has a JSON Schema and vectors | A checked-in event manifest is compared with protocol exports, JSON Schema files, and vector directories; any missing or extra entry fails. |
| Every JSON Schema uses Draft 2020-12 | The conformance suite verifies the exact `$schema` value and validates each file against the Draft 2020-12 meta-schema. |
| Checked-in paths and public IDs are deterministic | For every manifest entry, the suite derives `specs/messages/<message-name>/v<version>/schema.json` and the matching `https://anchr-spec.org/spec/message/<message-name>/v<version>/schema.json` `$id`; a spec-site test retrieves that URL. |
| Published IDs are immutable | A repository and generated-site assertion rejects a schema `$id` or redirect path containing `/latest/`. |
| Every JSON format owns an independent integer version, initially `0` | Every JSON Schema requires its own `version` with `const: 0`; vectors cover missing, string, and unsupported values, and a fixture proves one format can advance without changing sibling JSON Schemas. |
| Anchr-defined objects reject unknown fields | Each such object has `additionalProperties: false`; a generated invalid vector adds one unknown field at every Anchr-defined object boundary, and both JSON Schema validation and the parser reject it. Opaque values defined by a Proof Schema are excluded. |
| Version 0 has no implicit extension point | Schemas contain no generic extension object; a docs assertion requires the specification to state that fields are added by advancing the affected JSON format's version. |
| Every event has positive and negative coverage | The conformance suite requires at least one valid and one invalid vector per manifest entry. |
| Valid vectors agree with JSON Schema and parser | Each valid vector must pass JSON Schema validation and the protocol parser. |
| Invalid vectors fail at their declared layer | Each invalid vector declares `json_schema` or `parser`; the suite asserts that exact first rejection layer. |
| JSON Schemas do not claim cryptographic or transition validation | Structurally valid negative vectors exercise signature, encryption, and transition rejection in the parser layer. |
| Published JSON Schema URLs are stable and complete | A spec-site test resolves every manifest entry through `spec-site/schemas.json` and checks that the referenced artifact exists. |

## Verification

- The conformance suite runs in `deno task test:unit` (or a dedicated task
  wired into `test:all`) and fails when a parser and its JSON Schema diverge
  (verified once by mutating a JSON Schema field locally, then reverting).

## Plan

- Generate or hand-write JSON Schemas next to the specs; add a conformance test that reads the vectors;
  register pages in `spec-site/schemas.json`.

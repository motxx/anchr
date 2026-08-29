# Align Proof Schema public API names

Created: 2026-08-29
Model: OpenAI GPT-5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0225
- 0226
- 0227

## Summary

The public TypeScript API uses unqualified `Schema` names for values and
behavior that belong specifically to a Proof Schema. Names such as
`SchemaUri`, `SchemaBundle`, and `registerSchemaBundle` do not identify the
domain concept, and `SchemaUri` describes a value that the implementation
requires to be an HTTPS URL rather than a generic URI. The ambiguity increases
when the repository also publishes JSON Schemas for protocol messages.

Align the public API with the canonical `Proof Schema` vocabulary in
`CONTEXT.md`, using the concrete proof-production or proof-verification
responsibility where that is more accurate than mechanically adding a prefix.

## Rationale

- `packages/protocol/src/schema.ts` publicly exports `SchemaUri`,
  `isSchemaUri`, `UnknownSchemaError`, and `InvalidSchemaUriError`, although
  all four operate on Proof Schema HTTPS URLs.
- `packages/sdk/src/schema.ts`, `schema-options.ts`, and the root barrel expose
  a larger family including `SchemaBundle`, `SchemaProducer`,
  `SchemaVerifier`, `SchemaEvidencePayload`, `SchemaOptions`, their related
  contexts and resolvers, and registration and lookup functions.
- `packages/sdk/src/customer.ts` also exports `SchemaVerificationError`.
- `@anchr/protocol/schema` and `@anchr/sdk/schema` are public subpaths whose
  names should be considered in the same migration rather than leaving the
  module name and its exports inconsistent.
- This repository is pre-1.0: replaced public names and subpaths are removed
  directly rather than retained through compatibility aliases.
- Serialized fields such as `schema`, `schema_requirement`, and
  `schema_verdict` are protocol message fields with definitions in the
  specifications. They are outside this TypeScript API naming issue and must
  not be renamed without a separate versioned protocol decision.

## Acceptance

- Every public `Schema*` identifier exported by `@anchr/protocol` or
  `@anchr/sdk` is classified as a Proof Schema identifier, proof-production
  behavior, proof-verification behavior, JSON Schema behavior, or an unrelated
  concept.
- Public identifiers that refer to a Proof Schema use `ProofSchema` or name
  their concrete proof behavior; the HTTPS identifier uses `Url`, not `Uri`.
- Public subpath names and documentation agree with the final exported
  vocabulary.
- Replaced identifiers and subpaths have no deprecated aliases or compatibility
  wrappers.
- Protocol message field names are unchanged unless a separate versioned
  protocol issue is created and resolved first.

## Verification

- A checked-in public-API inventory test enumerates protocol and SDK exports
  and package subpaths. It fails when a public `Schema*` identifier or
  schema-named subpath lacks a classification from Acceptance, or when a
  replaced name remains exported.
- No obsolete public names are expected after the migration:
  `rg "SchemaUri|isSchemaUri|UnknownSchemaError|InvalidSchemaUriError|SchemaBundle|registerSchemaBundle|SchemaProducer|SchemaVerifier|SchemaEvidence|SchemaOptions|SchemaConfig|SchemaVerificationError" packages/protocol packages/sdk README.md docs specs examples --glob '!docs/issues/**'`
  returns no matches.
- `deno task publish:dry-run`, `deno task lint:strict`, and
  `deno task test:unit` pass.

## Plan

- Inventory the exported Proof Schema API and choose names from the domain
  concept or concrete behavior rather than applying a blind prefix rewrite.
- Migrate protocol and SDK exports, imports, tests, examples, and current
  documentation in one pre-1.0 change.
- Record any retained unqualified `Schema` name with the distinct concept it
  denotes.

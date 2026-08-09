# Generalize preimage delivery to scheme-tagged Release Material delivery

Created: 2026-07-26
Model: Claude Opus 5

## Priority

design

## Dependencies

Depends on:
- 0247

Blocks:
- 0252
- 0253

## Summary

The wire contract hardcodes one settlement scheme's release material.
`buildPreimageDeliveryEvent` / `parsePreimageDeliveryEvent`
(`packages/protocol/src/events.ts`) name and shape the payload around the
Cashu HTLC preimage, and the Oracle DMs carry a separate FROST-signature
variant (`buildFrostSignatureDM`). Roles that consume these events learn
scheme-specific field names, which couples Customer and Provider code to the
settlement backend and blocks adding a new scheme (for example NUT-CTF, where
the release material is the attestation signature set) without another
parallel event. Replace the per-scheme messages with one delivery contract
whose payload is `{scheme, material}` — opaque to roles, interpreted only by
the settlement adapter for that scheme.

## Rationale

- Target principle (2026-07-26 design session): Anchr assembles unlock
  conditions and transports Release Material; roles never interpret it.
  Scheme-specific names on the wire violate the transport role.
- `specs/messaging.md` owns the payload tables and must change with the
  events.
- Existing schemes become tags: HTLC preimage and FROST signature are the two
  initial `scheme` values; the NUT-CTF prototype (0253) would add a third
  without a wire change.
- Sequencing: 0247 first moves the remaining Oracle DMs into
  `@anchr/protocol`, so this issue edits one owner.

## Acceptance

- One release-material delivery contract exists in `@anchr/protocol`, with a
  scheme tag and an opaque material payload; the preimage-specific and
  FROST-specific delivery variants are deleted (pre-1.0, no compat shims).
- Customer- and Provider-facing types expose release material opaquely; no
  role-facing type names a scheme-specific field for it.
- The contract specifies the `material` encoding (JSON type and
  canonicalization), the registered `scheme` identifiers and how new ones are
  added, and parser behavior for unknown schemes — enough for another-language
  implementation to validate the payload and for 0252 to derive stable
  schemas and test vectors.
- `specs/messaging.md` documents the generalized payload and those rules.

## Verification

- No matches expected:
  `rg "PreimageDelivery|FrostSignatureDM" packages/protocol/src packages/sdk/src --glob '!*test*'`
  (scheme adapters under payments/ may keep internal preimage vocabulary).
- `deno task lint:strict`, `deno task test:unit`,
  `deno task test:e2e:protocol` pass; `deno task test:e2e:frost` passes where
  infra is available.

## Plan

- Define the tagged payload in protocol events plus spec table.
- Migrate the Oracle daemon and role facades; delete the old builders and
  parsers.

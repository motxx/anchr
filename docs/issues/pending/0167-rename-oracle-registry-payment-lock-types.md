# Rename Oracle registry payment lock type field

Created: 2026-06-18
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The live Oracle registry vocabulary still exposes `supported_escrow_types` and
"escrow types" even though the current domain vocabulary uses Payment Lock and
marks Escrow as an avoided term. The registry field is public-ish protocol and
SDK surface, so the cleanup should be handled as its own focused change rather
than folded into README wording updates.

## Rationale

Relevant references:

- `CONTEXT.md` defines Payment Lock and lists Escrow under `_Avoid_`.
- `specs/oracle-registry.md` documents `supported_escrow_types`.
- `packages/sdk/src/adapters/oracle-client/oracle-discovery.ts` and relay
  discovery tests consume the same field.

Because the field appears in Nostr registry event content, the resolver should
re-read the current protocol compatibility expectations before choosing the
exact replacement name and migration shape.

## Acceptance

- Live documentation and public SDK Oracle registry types use Payment Lock
  vocabulary for advertised settlement-lock capabilities.
- Any remaining `escrow` wording in this area is either removed, confined to
  older internal implementation names, or explicitly justified as a current
  compatibility boundary.
- Oracle discovery tests cover the accepted field name and rejection or handling
  behavior for obsolete names according to the chosen migration policy.

## Verification

- `rg -n "supported_escrow_types|escrow types|P2PK escrow" specs packages/sdk e2e`
  reports no unexpected live public-surface matches; closed issues are out of
  scope for this check.
- `deno test packages/sdk/src/adapters/oracle-client/oracle-discovery.test.ts e2e/relay/oracle-discovery.test.ts --allow-env --allow-net --allow-read --allow-write`
- `deno task lint:strict`

## Plan

- Re-read the Oracle registry spec, SDK discovery parser, event builders, and
  relay discovery tests.
- Choose the replacement field name and migration behavior for the pre-1.0
  protocol surface.
- Update the spec, SDK types/parsers/builders, and focused tests in one
  verifiable change.

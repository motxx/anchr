# Trim protocol wire only

Created: 2026-05-23
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0046

Blocks:
- 0047

## Summary

Keep `@anchr/protocol` limited to role-neutral wire events, schemas,
validators, Nostr wire encoding, and protocol types. Move or delete adapter
capability surfaces that belong to SDK.

## Rationale

#0046 states that protocol owns compatibility, not runtime convenience.
`@anchr/protocol/capabilities` and protocol adapter metadata should not remain
unless a concrete cross-implementation wire reason is recorded in `specs/`.

Relevant current surfaces:

- `packages/protocol/src/adapters.ts`
- `packages/protocol/src/capabilities.ts`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/schema.ts`
- `packages/protocol/src/types.ts`
- `packages/protocol/src/nostr.ts`

## Acceptance

- `packages/protocol/src/` contains only wire events, schemas, validators,
  Nostr wire encoding, and role-neutral protocol types.
- `@anchr/protocol/capabilities` is deleted or moved to SDK unless a
  wire-compatibility reason is recorded in `specs/`.
- `packages/protocol/deno.json` has no dependency on another Anchr package.
- Protocol tests cover the retained wire-only exports.

## Verification

- No matches are expected:
  `rg -n "@anchr/(sdk|customer-sdk|provider-sdk|oracle-sdk|core-runtime|core-cashu|adapters|bounty)" packages/protocol`
- No matches are expected unless justified in `specs/`:
  `rg -n "capabilities|adapter" packages/protocol/src packages/protocol/deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Classify each protocol export as wire contract, schema, validator, type, or
  runtime convenience.
- Move SDK-owned adapter and capability code to SDK or delete it.
- Keep protocol imports free of Anchr package dependencies.
- Update protocol tests for the retained wire-only surface.

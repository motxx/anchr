# Dedup the NIP-44 decrypt/parse boilerplate in protocol/events.ts

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

Several event parsers in `protocol/events.ts` re-implement the same
`decryptNip44 → JSON.parse → typeof shape check` sequence, while a helper
(`decryptDmJson`) already encapsulates it for only two of them. This is the
wire-contract validation surface; inconsistent copies invite subtle validation
drift between message types.

## Rationale

- `packages/protocol/src/events.ts`: `parseSelectionFeedbackEvent`
  (~288-350), `parseQueryResponseEvent` (~433-466),
  `parseOracleQueryResponseEvent` (~473-514), `parsePreimageDeliveryEvent`
  (~562-594) each re-implement the dance that `decryptDmJson` (~698-718)
  already provides for the two hash parsers.

## Acceptance

- All NIP-44 DM/content parsers route through one `decryptJson`-style helper,
  then apply per-type shape checks.

## Verification

- `deno task test:unit` (protocol) passes; grep shows the decrypt+parse
  sequence defined once.

## Plan

- Generalise `decryptDmJson` and switch the four parsers to it.

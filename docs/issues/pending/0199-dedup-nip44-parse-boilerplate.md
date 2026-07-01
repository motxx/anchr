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
- Scope extension (2026-07-02 architecture review): the same boilerplate
  exists on the SDK side in `adapters/nostr/events/dm.ts` —
  `buildPreimageDM` (~34-50), `buildRejectionDM` (~65-80), and
  `buildFrostSignatureDM` (~99-114) are three near-identical
  derive-conversation-key → encryptNip44(JSON.stringify) → kind-4 template →
  finalize sequences, and `parseOracleDM` (~147-169) repeats the
  decrypt+parse dance.

## Acceptance

- All NIP-44 DM/content parsers route through one `decryptJson`-style helper,
  then apply per-type shape checks.
- The SDK DM builders/parser in `adapters/nostr/events/dm.ts` route through
  one shared build/parse helper as well (or a recorded reason keeps them
  separate).

## Verification

- `deno task test:unit` (protocol) passes; grep shows the decrypt+parse
  sequence defined once.

## Plan

- Generalise `decryptDmJson` and switch the four parsers to it.

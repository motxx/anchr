# Extract shared SDK adapters

Created: 2026-05-20
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0037
- 0039

Blocks:
- 0041
- 0043

## Summary

Move the duplicated actor SDK adapter implementations into shared adapter
packages or modules. The Customer and Provider SDKs already depend on explicit
ports (`cashuClient`, `relayClient`, and `stateStore`), but their bundled
Cashu, Nostr, and state-store implementations currently live inside both actor
SDK package directories.

## Rationale

Relevant references:

- `packages/customer-sdk/src/cashu.ts`
- `packages/provider-sdk/src/cashu.ts`
- `packages/customer-sdk/src/nostr.ts`
- `packages/provider-sdk/src/nostr.ts`
- `packages/customer-sdk/src/storage.ts`
- `packages/provider-sdk/src/storage.ts`
- `packages/customer-sdk/src/types.ts`
- `packages/provider-sdk/src/types.ts`

The port shape is healthy: actor SDK constructors require explicit adapters.
The physical implementation boundary is the problem. Adapter code is duplicated
between actor SDKs, which makes Cashu, Nostr, and local-state behavior harder
to evolve consistently and makes the eventual `packages/adapters/*` taxonomy
awkward.

## Plan

- Extract shared port-compatible implementations for Cashu, Nostr relay, and
  actor local state into the accepted adapter location.
- Keep Customer and Provider SDK core packages focused on actor orchestration
  and public actor types.
- Preserve or intentionally replace existing public exports in one coordinated
  change.
- Update `packages/sdk` aggregate exports and package READMEs.
- Add or move tests so adapter behavior is verified once at the adapter
  boundary instead of duplicated per actor SDK.

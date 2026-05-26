# Extract shared SDK adapters

Created: 2026-05-20
Model: GPT-5
Completed: 2026-05-20

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

## Resolution

Implemented by updating:

- `packages/adapters/`
- `packages/protocol/src/adapters.ts`
- `packages/customer-sdk/src/customer.ts`
- `packages/customer-sdk/src/types.ts`
- `packages/provider-sdk/src/provider.ts`
- `packages/provider-sdk/src/types.ts`
- `packages/sdk/src/index.ts`
- `packages/core-cashu/src/htlc-options.ts`
- `docs/architecture.md`

Verified with:

- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys packages/adapters/src/cashu.test.ts packages/adapters/src/storage.test.ts packages/customer-sdk/src/customer.test.ts packages/customer-sdk/src/integration.test.ts packages/provider-sdk/src/provider.test.ts packages/sdk/src/index.test.ts`
- `deno task test:unit`
- `deno task lint:strict`
- `deno task lint:arch -- --errors-only`
- `check-silent-bypass` review for changed settlement/payment files

Harness update:

- Adapter behavior tests moved to `packages/adapters/src/cashu.test.ts` and
  `packages/adapters/src/storage.test.ts`; actor SDK tests now use local port
  fakes instead of importing concrete adapters.

Review residuals:

- `packages/adapters` is a transitional flat package that maps to the accepted
  adapter boundary. The final nested package taxonomy and stricter linting are
  tracked by #0043.

Follow-up:

- #0041
- #0043

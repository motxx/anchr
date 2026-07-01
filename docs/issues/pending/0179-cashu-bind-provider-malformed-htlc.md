# Fix cashu-escrow-provider bindProvider building a malformed HTLC

Created: 2026-07-02
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`cashu-escrow-provider.bindProvider` recovers `customerPubkey`, `locktime`, and
`hash` by JSON-parsing the secret of Phase-1 proofs — but those proofs are
plain (no HTLC/P2PK tags) by design, so the parse always throws and the values
fall back to empty strings / `now+3600`. The HTLC is then bound with an empty
hashlock and empty refund key, dropping the real `payment_hash`,
`customer_pubkey`, and `expiry`. The sibling `frost-escrow-provider` guards
against an empty refund pubkey; the Cashu path does not.

## Rationale

- `packages/sdk/src/payments/cashu/cashu-escrow-provider.ts` (~lines 46-90):
  `JSON.parse(firstProof.secret)` on plain proofs; `createHold` (~line 25) →
  `createHtlcToken` emits plain proofs (`cashu-escrow.ts` ~lines 215-238).
- `frost-escrow-provider.ts` throws on empty refund pubkey (~lines 45-51,
  114-117); no equivalent guard here.

## Acceptance

- `createHold` carries `payment_hash` / `customer_pubkey` / `expiry` in its
  `tokenMap` entry and `bindProvider` consumes those values instead of parsing
  plain-proof secrets.
- `bindProvider` refuses to bind with an empty `hash` or
  `customerRefundPubkey`.

## Verification

- Unit test: after `createHold` + `bindProvider`, the bound HTLC carries the
  original hash/refund-key/locktime and a subsequent `verifyLock` accepts it.

## Plan

- Thread the hold parameters through `tokenMap`.
- Add empty-value guards mirroring `frost-escrow-provider`.

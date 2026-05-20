# `@anchr/core-cashu` — Implementation Spec

> **Scope:** the Cashu HTLC escrow primitive that this package owns. The
> threshold-signing variant lives in `packages/frost-oracle/SPEC.md`;
> the conditional-swap (cross-HTLC + dual-preimage) wire format is in
> `specs/conditional-swap.md`.

This document describes how `@anchr/core-cashu` realises an
`EscrowProvider`-shaped Hash Time-Locked Contract using Cashu NUT-11
(P2PK) and NUT-14 (HTLC) spending conditions.

## EscrowProvider Interface

The host binds to escrow through this contract:

```
EscrowProvider
  createHold(amount, hash, requesterPubkey, locktime) → EscrowRef
  bindWorker(ref, workerPubkey)                        → void
  verifyAmount(ref, expectedSats)                      → boolean
  settleWithPreimage(ref, preimage)                    → void
  cancel(ref)                                          → void
```

Swapping from Cashu to Fedimint, Lightning PTLC, or DLC means
implementing a new provider — not changing the protocol or the host.

## HTLC Mechanism (Cashu NUT-14)

### Setup

1. Oracle generates a random preimage and returns
   `hash = SHA-256(preimage)` to the Requester.
2. Requester chooses the Phase 1 exposure mode:
   - **Local hold.** The Requester keeps plain proofs private until a Worker is
     selected. `buildHtlcInitialOptions()` returns `null` for this mode.
   - **Preselection transfer.** If a token or proof set is visible before
     Worker selection, the Requester locks it with P2PK(Requester) using
     `buildHtlcPreselectionOptions()`. This prevents relay observers or
     unselected actors from spending the visible proofs.
3. After Worker selection, Requester swaps into a Cashu token with three
   spending conditions:
   - `hash(preimage)` — HTLC condition (NUT-14)
   - `Worker pubkey` — P2PK condition (NUT-11)
   - `locktime` — refund after expiry
4. Requester sends the final escrow token to the Worker (via Nostr or HTTP).

The preselection-transfer token deliberately omits the hashlock. The Requester
does not yet have the preimage, so adding the hashlock in Phase 1 would make the
Requester unable to perform the Phase 2 swap before Oracle release.

### Redemption

- **Success.** Oracle reveals preimage to Worker. Worker redeems with
  `preimage + Worker signature`.
- **Timeout.** After locktime, Requester reclaims the token.

### Security

| Property | Guarantee |
|----------|-----------|
| Oracle cannot steal | HTLC requires Worker's signature |
| Worker cannot redeem without proof | Oracle holds the preimage |
| Relay observer cannot spend preselection token | Preselection transfer mode uses P2PK(Requester) |
| Requester cannot revoke | Sats locked before work begins |
| Timeout refund | Automatic after locktime |

## EscrowInfo Structure

| Field | Description |
|-------|-------------|
| `type` | `htlc` or `p2pk_frost` (P2PK+FROST is described in `frost-oracle/SPEC.md` and `cashu-conditional-swap/README.md`) |
| `hash` | SHA-256 hash of preimage (HTLC only) |
| `oracle_pubkeys` | Oracle pubkey(s); single for HTLC, group for FROST |
| `requester_pubkey` | Requester's Nostr pubkey (hex) |
| `worker_pubkey` | Worker's Nostr pubkey (set after selection) |
| `locktime` | Unix timestamp for refund |
| `escrow_token` | Encoded Cashu token |
| `verified_escrow_sats` | Server-verified escrow amount |

## Denomination Agnosticism

The escrow mechanism is denomination-agnostic. Cashu mints support
multiple units (sat, USD, EUR). The `EscrowProvider` does not care what
the unit is — it operates on amounts and conditions.

## Test References

- `packages/core-cashu/src/escrow.ts`, `escrow-helpers.ts`,
  `preimage-store.ts`
- HTLC redemption fuzz tests:
  `e2e/regtest-htlc-trustless.test.ts`,
  `e2e/regtest-htlc-attacks.test.ts`
- Unit-test invariants tracked in `docs/threat-model.md` (INV-02, INV-03).

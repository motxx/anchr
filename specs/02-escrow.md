# Spec 02: Escrow

## Abstract

Escrow locks payment before work begins and releases it only upon verification. This spec defines the escrow interface and two concrete mechanisms: HTLC and P2PK+FROST.

## EscrowProvider Interface

All escrow mechanisms implement the same interface:

```
EscrowProvider
  createHold(amount, hash, requesterPubkey, locktime) → EscrowRef
  bindWorker(ref, workerPubkey) → void
  verifyAmount(ref, expectedSats) → boolean
  settleWithPreimage(ref, preimage) → void
  cancel(ref) → void
```

The protocol interacts only with this interface. Swapping from Cashu to Fedimint, Lightning PTLC, or DLC requires implementing a new provider — not changing the protocol.

## Mechanism 1: HTLC (Cashu NUT-14)

Hash Time-Locked Contract using Cashu ecash.

### Setup

1. Oracle generates a random preimage and returns `hash = SHA-256(preimage)` to the Requester.
2. Requester creates a Cashu token with spending conditions:
   - `hash(preimage)` — HTLC condition (NUT-14)
   - `Worker pubkey` — P2PK condition (NUT-11)
   - `locktime` — refund after expiry
3. Requester sends the escrow token to the Worker (via Nostr or HTTP).

### Redemption

- **Success**: Oracle reveals preimage to Worker. Worker redeems with `preimage + Worker signature`.
- **Timeout**: After locktime, Requester reclaims the token.

### Security

| Property | Guarantee |
|----------|-----------|
| Oracle cannot steal | HTLC requires Worker's signature |
| Worker cannot redeem without proof | Oracle holds preimage |
| Requester cannot revoke | Sats locked before work begins |
| Timeout refund | Automatic after locktime |

## Mechanism 2: P2PK + FROST (Cashu NUT-11)

Used with threshold Oracle (t-of-n). Instead of HTLC, escrow is locked to the FROST group public key.

### Setup

1. FROST DKG produces a `group_pubkey` (BIP-340 x-only).
2. Requester creates a Cashu token with P2PK conditions:
   - `group_pubkey` — requires FROST group signature
   - `Worker pubkey` — requires Worker signature
   - `locktime` — refund after expiry

### Redemption

- **Success**: t-of-n Oracles produce FROST signature shares. Shares are aggregated into a BIP-340 Schnorr group signature. Worker redeems with `group_signature + Worker signature`.
- **Timeout**: After locktime, Requester reclaims.

### Security

Inherits all HTLC guarantees, plus:

| Property | Guarantee |
|----------|-----------|
| No single Oracle decides | Requires t-of-n signatures |
| Byzantine tolerance | Up to n-t malicious Oracles tolerated |

## Escrow Types

| Type | Condition | Use case |
|------|-----------|----------|
| `htlc` | `SHA-256(preimage) + Worker sig` | Single Oracle |
| `p2pk_frost` | `FROST group sig + Worker sig` | Threshold Oracle |

## EscrowInfo Structure

| Field | Description |
|-------|-------------|
| `type` | `htlc` or `p2pk_frost` |
| `hash` | SHA-256 hash of preimage (HTLC only) |
| `oracle_pubkeys` | Oracle pubkeys (single for HTLC, group for FROST) |
| `requester_pubkey` | Requester's Nostr pubkey (hex) |
| `worker_pubkey` | Worker's Nostr pubkey (set after selection) |
| `locktime` | Unix timestamp for refund |
| `escrow_token` | Encoded Cashu token |
| `verified_escrow_sats` | Server-verified escrow amount |

## Denomination Agnosticism

The escrow mechanism is denomination-agnostic. Cashu mints support multiple units (sat, USD, EUR). The `EscrowProvider` does not care what the unit is — it operates on amounts and conditions.

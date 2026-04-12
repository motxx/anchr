# Spec 07: Conditional Swap

## Abstract

The conditional swap is an N:M primitive that extends Anchr's 1:1 atomic swap to support binary-outcome markets. Matched pairs lock tokens in opposite directions. The Oracle reveals the winning preimage; the winner redeems the loser's tokens.

## Motivation

Anchr's core protocol is a 1:1 atomic swap: one Requester pays one Worker for one proof. The conditional swap generalizes this to N:M — multiple parties bet against each other on a binary outcome, with the Oracle resolving which side wins.

Use cases: prediction markets, insurance, group bounties, auctions.

## Cross-HTLC Dual-Preimage Pattern

The Oracle generates two preimages for two mutually exclusive outcomes:

| Outcome | Preimage | Hash |
|---------|----------|------|
| A (e.g., YES) | `preimage_a` | `hash_a = SHA-256(preimage_a)` |
| B (e.g., NO) | `preimage_b` | `hash_b = SHA-256(preimage_b)` |

Both hashes are published at market creation. The Oracle reveals exactly one preimage at resolution.

## ConditionalSwapDef

| Field | Description |
|-------|-------------|
| `swap_id` | Unique swap identifier |
| `hash_a` | SHA-256 hash for outcome A |
| `hash_b` | SHA-256 hash for outcome B |
| `locktime` | Unix timestamp; after this, both sides refund |

## Matched Pairs

Participants are matched into pairs. Each pair consists of two parties betting on opposite outcomes.

### SwapPair

| Field | Description |
|-------|-------------|
| `pair_id` | Unique pair identifier |
| `swap_id` | Parent swap |
| `party_a_pubkey` | Party A's public key (bets on outcome A) |
| `party_b_pubkey` | Party B's public key (bets on outcome B) |
| `amount_sats` | Amount locked by each party |
| `token_a_to_b` | Escrow token: A→B direction, redeemable by B if outcome B wins |
| `token_b_to_a` | Escrow token: B→A direction, redeemable by A if outcome A wins |
| `status` | `pending`, `locked`, `settled_a`, `settled_b`, `expired` |

### Token Locking

Each party locks a Cashu token to the *opposite* outcome's hash:

- Party A locks `token_a_to_b` with condition `hash_b + Party B's pubkey`
- Party B locks `token_b_to_a` with condition `hash_a + Party A's pubkey`

This ensures:
- If outcome A wins: Oracle reveals `preimage_a`. Party A redeems `token_b_to_a` using `preimage_a + Party A's signature`.
- If outcome B wins: Oracle reveals `preimage_b`. Party B redeems `token_a_to_b` using `preimage_b + Party B's signature`.
- If timeout: Both tokens refund to their original owners.

## Resolution

1. The Oracle fetches verifiable data (e.g., TLSNotary proof of a price feed).
2. The Oracle evaluates the outcome condition against the verified data.
3. The Oracle reveals exactly one preimage (`preimage_a` or `preimage_b`).
4. Winners redeem escrow tokens from their matched pairs.

## Pair States

```
pending --> locked --> settled_a  (outcome A won)
                  --> settled_b  (outcome B won)
                  --> expired    (locktime reached)
```

## Matching Layer

### Coordinator

A Coordinator maintains an order book and proposes matches. The Coordinator can be a market maker, a relay operator, or a self-hosted service.

The Coordinator is NOT trusted with funds. It cannot steal tokens because escrow conditions are bound to hash preimages that only the Oracle controls. The Coordinator is a convenience layer for pairing participants.

### Order Book

The order book collects open orders from participants:

| Field | Description |
|-------|-------------|
| `id` | Unique order identifier |
| `market_id` | Which swap/market this order belongs to |
| `side` | `yes` (outcome A) or `no` (outcome B) |
| `pubkey` | Participant's public key |
| `amount_sats` | Total amount to bet |
| `remaining_sats` | Amount not yet matched |
| `timestamp` | Order creation time |

Operations:
- `addOrder(order)` — add to the book
- `cancelOrder(id)` — remove before matching
- `getOpenOrders(market_id, side?)` — list open orders
- `matchOrders(market_id)` — run matching algorithm

### Matching Algorithm

The default algorithm is greedy FIFO: earliest orders are matched first. For each YES/NO pair:

1. Take the earliest unmatched YES order and earliest unmatched NO order.
2. Match amount = `min(yes.remaining_sats, no.remaining_sats)`.
3. Produce a `MatchProposal { yes_order_id, no_order_id, amount_sats }`.
4. Reduce `remaining_sats` on both orders.
5. Orders with `remaining_sats > 0` stay in the book (partial fill).

Other algorithms (pro-rata, CLOB) are permitted — the protocol does not prescribe the matching strategy.

### Match Execution

For each `MatchProposal`, the Coordinator:

1. Collects Cashu proofs from both parties.
2. Creates cross-HTLC tokens via `createSwapPairTokens` (see Token Locking above).
3. Returns the locked `SwapPair` to both parties.

Both parties can verify match fairness by checking that their locked amount matches the proposal and that escrow conditions reference the correct hashes and pubkeys.

## Relationship to Core Protocol

The 1:1 bounty query (Specs 00-06) is the special case where N=1, M=1. The conditional swap extends this to N:M by:

1. Replacing the single preimage with a dual-preimage scheme.
2. Introducing a matching layer that pairs participants.
3. Using the same `EscrowProvider`, `verify()`, and messaging infrastructure.

The Oracle's role is identical: verify data, produce an attestation, release the appropriate preimage. The difference is that the preimage resolves many pairs simultaneously.

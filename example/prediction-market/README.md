# Prediction Market Example

A demo application using Anchr's Oracle + TLSNotary verification for prediction market resolution.

## What This Is

This example demonstrates Anchr's Oracle capabilities — TLSNotary-verified data feeds, FROST threshold signing, and condition evaluation — applied to a prediction market use case.

## Current Limitations

**Settlement relies on Oracle escrow (t-of-n).** Cashu's standard NUTs lack conditional branching (IF YES THEN pay A, ELSE pay B), so the Oracle group holds funds and distributes to winners based on the outcome.

If t-of-n Oracle nodes collude, they can steal funds. This is a demo with an Oracle trust assumption, not suitable for large amounts.

Fully trustless settlement requires one of:
- [DLC NUT (cashubtc/nuts PR #128)](https://github.com/cashubtc/nuts/pull/128) — DLC execution on a Cashu mint
- Cashu v2 atomic P2P trading
- DLC on Bitcoin L1

**Anchr's Oracle verification, TLSNotary proofs, and FROST threshold signing work with any settlement layer.**

## How It Works

```
1. Market created → Oracle generates FROST group keypair (YES/NO)
2. Bettors send sats to Oracle escrow:
   P2PK([oracle_group_pubkey], n_sigs=1), refund: user, locktime: deadline+1h
3. Oracle fetches resolution URL via TLSNotary, verifies data
4. Condition evaluation (evaluateCondition) → outcome determined
5. FROST t-of-n signing → winner paid / locktime refund if Oracle inactive
```

## Resolution Conditions

| Type | Description | Example |
|------|-------------|---------|
| `jsonpath_gt` | JSON value > threshold | BTC/JPY > 15,000,000 |
| `jsonpath_lt` | JSON value < threshold | ETH gas < 10 gwei |
| `contains_text` | Response contains text | "winner: Team A" |
| `jsonpath_equals` | JSON value = expected | `status` == "completed" |

## Running

```bash
# Demo (mock data)
deno run --allow-all example/prediction-market/src/demo.ts

# Server
deno run --allow-all example/prediction-market/server.ts

# Tests
deno test --allow-all example/prediction-market/

# FROST 2-of-3 cluster
scripts/frost-market-dkg-bootstrap.ts --threshold 2 --total 3
scripts/frost-market-oracle-cluster.ts
```

## Files

```
src/
  server-routes.ts          — Market API (order book, matching, resolution)
  market-types.ts           — Type definitions
  market-oracle.ts          — Condition evaluation, payout calculation
  order-book.ts             — FIFO matching
  resolution.ts             — Dual-preimage / FROST P2PK resolution
  exchange-protocol.ts      — Client-side token creation and verification
  frost-conditional-swap.ts — FROST P2PK dual-key signing
  match-coordinator.ts      — Cross-HTLC match execution
  nostr-market.ts           — Nostr event builder (kind 30078)
  attack-scenarios.test.ts  — Attack vector tests (6 scenarios)
ui/
  wallet.ts                 — Browser Cashu wallet (localStorage)
  keypair.ts                — Nostr keypair management
  api.ts                    — API client
  MarketApp.tsx             — React UI
```

## Known Attack Vectors

| Attack | Status | Notes |
|--------|--------|-------|
| Oracle (t-of-n) collusion — fund theft | Open | Requires DLC NUT for resolution |
| Matchmaker DoS | Mitigated | Multiple matchmakers + Nostr redundancy |
| Locktime refund race | Addressed | locktime = resolution_deadline |
| Per-proof FROST signature mismatch | Fixed | Signs SHA256(proof.secret) per proof |
| Oracle double-signing (both outcomes) | Addressed | DualKeyStore deletes losing key (single-key mode) |
| Cross-market replay | Safe | Unique nonce per proof |

# Prediction Market Example

A demo application using Anchr's Oracle + TLSNotary verification + Cashu
HTLC (or FROST P2PK) atomic settlement for prediction-market resolution.

## What this is

This example demonstrates Anchr's Oracle capabilities — TLSNotary-verified
data feeds, FROST threshold signing, and condition evaluation — applied
to a prediction-market use case.

## Settlement model — funds are *not* held by the Oracle

Earlier drafts of this README described an "Oracle-as-escrow" design
(`P2PK([oracle_group_pubkey], n_sigs=1)` where the Oracle group held the
pool). **The actual implementation does not work that way.** Funds stay
between the bettors at all times via cross-locked Cashu tokens; the
Oracle's role is to release a single secret (preimage or signature share)
that lets the *winner* unlock the *loser's* counterparty token.

There are two settlement modes, both audited end-to-end against a real
Cashu mint on regtest. They differ only in what kind of secret the Oracle
emits.

### HTLC mode (`packages/cashu-conditional-swap/src/cross-htlc.ts`)

```
Bettor A's proofs:  hashlock(hash_b) + P2PK(B) + refund(A) + locktime
Bettor B's proofs:  hashlock(hash_a) + P2PK(A) + refund(B) + locktime
```

- Each bettor's sats are locked **to the counterparty's pubkey + the
  counterparty's outcome hash**. They never enter an Oracle wallet.
- Oracle reveals `preimage_a` if YES wins (or `preimage_b` if NO).
- Winner uses `preimage + their own signature` to redeem the loser's
  cross-locked token.
- If the Oracle never reveals: locktime expires → each bettor refunds
  their own original proofs to themselves.

### FROST P2PK mode (`packages/cashu-conditional-swap/src/frost-conditional-swap.ts`)

```
Bettor A's proofs:  P2PK([group_pubkey_b, B_pubkey], n_sigs=2) + refund(A) + locktime
Bettor B's proofs:  P2PK([group_pubkey_a, A_pubkey], n_sigs=2) + refund(B) + locktime
```

- Each bettor's sats are locked under a **2-of-2 multisig: the FROST
  group key for the *opposite* outcome AND the counterparty's personal
  key**. Funds never enter the Oracle's wallet either.
- To redeem the counterparty's token, the winner needs both signatures.
- If the Oracle never produces a FROST signature: locktime expires →
  refund.

## Trust model

| Behaviour | Outcome |
|---|---|
| Oracle signs / reveals correctly | Winner redeems the loser's token; loser refunds nothing. |
| Oracle never responds | Both bettors refund their own original proofs after `locktime`. No theft. |
| Oracle (FROST) signs the *wrong* outcome's key | Loser-as-redeemer still needs the loser's own personal sig (which is on the wrong side of the lock). The Oracle's lone share doesn't unlock anything. |
| t-of-n FROST nodes collude on *both* keys | Each bettor can redeem the counterparty's token. Net wash — no theft, just bilateral payout. |
| Single-sig (demo) DualKeyStore reveals both | Same wash result; loser side's secret key is permanently deleted on first sign (`packages/cashu-conditional-swap/src/frost-conditional-swap.ts`). |

The mint is still a trust point (it executes the swap); Anchr can swap to
DLC NUT (`cashubtc/nuts#128`) for atomic mint-side conditional payouts
once that PR lands, or to DLC on Bitcoin L1 for fully on-chain
settlement, without changing the Oracle code.

## How tests verify this

The lock structure and oracle-isolation are exercised end-to-end at three
layers:

| Layer | File | What it proves |
|---|---|---|
| Unit (no infra) | `packages/cashu-conditional-swap/src/cross-htlc.test.ts` | `buildCrossHtlcForPartyA/B` produce HTLC P2PK options with the **counterparty's** hash and pubkey. 4 tests. |
| Unit (no infra) | `packages/cashu-conditional-swap/src/frost-conditional-swap.test.ts` | `buildFrostSwapForPartyA/B` produce **2-of-2** P2PK options containing the FROST group pubkey **and** the counterparty pubkey; `DualKeyStore.sign` deletes the losing key on first sign and refuses to sign twice. 22 tests. |
| E2E on regtest | `e2e/conditional-swap.test.ts` | Mints real Cashu proofs via Lightning, executes a YES/NO match, asserts each proof's HTLC secret carries `hash_a` / `hash_b` (not Oracle pubkey), oracle reveals `preimage_a`, **YES bettor** redeems NO's locked tokens with `preimage + YES private key`. 11 steps. Run via `deno task test:regtest`. |
| E2E on regtest | `e2e/frost-p2pk-cashu.test.ts` | Locks Alice's proofs to `[group_pubkey_no, bob]` 2-of-2 and Bob's to `[group_pubkey_yes, alice]`; verifies that **only `[oracle_yes_sk, alice_sk]` together** can redeem Bob's proofs, and that Bob alone, the wrong group key, or a random third party each fail (only 1 of 2 required signatures). 9 lifecycle steps + 3 structural tests. |

Run the unit subset locally without Docker:

```bash
deno test packages/cashu-conditional-swap/src/cross-htlc.test.ts \
          packages/cashu-conditional-swap/src/frost-conditional-swap.test.ts \
          --allow-all
# 26 passed | 0 failed
```

The full regtest suite runs in CI's Phase 3 (Cashu + Lightning Docker
stack).

## Resolution flow

```
1. Market created → Oracle generates dual preimages (HTLC) or DKG group keys (FROST)
2. Bettors mint Cashu proofs from their Lightning balance
3. Order book matches YES / NO orders → MatchProposal
4. Match executor cross-locks each bettor's proofs (counterparty pubkey +
   counterparty's outcome hash / FROST group key)
5. Oracle fetches resolution URL via TLSNotary, verifies server name +
   timestamp + condition (jsonpath_gt / lt / equals / contains_text)
6. Oracle reveals winning preimage or FROST signature; loser secret is
   permanently deleted
7. Winner redeems counterparty's locked proofs at the mint
8. If Oracle is silent: locktime expires → both bettors refund
```

## Resolution conditions

| Type | Description | Example |
|---|---|---|
| `jsonpath_gt` | JSON value > threshold | BTC/JPY > 15,000,000 |
| `jsonpath_lt` | JSON value < threshold | ETH gas < 10 gwei |
| `contains_text` | Response contains text | "winner: Team A" |
| `jsonpath_equals` | JSON value = expected | `status` == "completed" |

## Known constraints (versus Polymarket / Kalshi / Manifold)

| Item | Status |
|---|---|
| 1:1 matched orders only (no CLOB / arbitrary probability pricing) | Not implemented |
| Secondary market — exit a position before resolution | Not implemented |
| Multi-outcome markets (>2 outcomes) | Not implemented; binary YES / NO only |
| Subjective resolution (UMA-style human dispute) | Not in scope; only deterministic HTTPS conditions |
| Mint-side conditional payouts (DLC NUT) | Pending [`cashubtc/nuts#128`](https://github.com/cashubtc/nuts/pull/128) |
| On-chain DLC settlement | Out of scope for this example |

## Running

```bash
# Demo (mock data)
deno run --allow-all example/prediction-market/src/demo.ts

# Server
deno run --allow-all example/prediction-market/server.ts

# All example tests (no Docker required)
deno test --allow-all example/prediction-market/

# Real Cashu mint E2E (requires `docker compose up -d` + init-regtest.sh)
deno task test:regtest

# FROST 2-of-3 cluster (after building crates/frost-signer)
scripts/frost-market-dkg-bootstrap.ts --threshold 2 --total 3
scripts/frost-market-oracle-cluster.ts
```

## Files

```
src/
  server-routes.ts          — Market HTTP API (order book, matching, resolution)
  market-types.ts           — Type definitions
  market-oracle.ts          — Condition evaluation, payout calculation
  order-book.ts             — FIFO matching with partial fills
  resolution.ts             — DualPreimageStore (HTLC) / DualKeyStore (FROST) resolution
  match-coordinator.ts      — Cross-HTLC match execution via @anchr/cashu-conditional-swap
  market-api-routes.ts      — REST endpoints
  market-signer-endpoints.ts — FROST signing-coordinator HTTP endpoints
  nostr-market.ts           — Nostr event builder (kind 30078)
  attack-scenarios.test.ts  — Attack vector tests (6 scenarios)
ui/
  wallet.ts                 — Browser Cashu wallet (localStorage)
  keypair.ts                — Nostr keypair management
  api.ts                    — API client
  MarketApp.tsx             — React UI
```

## Known attack vectors (tested)

| Attack | Status | Test |
|---|---|---|
| Locktime refund race | Mitigated | `attack-scenarios.test.ts` Attack 1 |
| Oracle double-signing both outcomes | Wash, no theft | `frost-conditional-swap.test.ts` (DualKeyStore deletes losing key on first sign) + `attack-scenarios.test.ts` Attack 2 |
| Oracle signature must match proof secret | Enforced | `attack-scenarios.test.ts` Attack 3 |
| Loser cannot redeem with winner's signature | Rejected by mint | `attack-scenarios.test.ts` Attack 4 |
| Cross-market replay | Safe (per-proof signing) | `attack-scenarios.test.ts` Attack 5 |
| Insufficient signatures without Oracle | Rejected by mint | `attack-scenarios.test.ts` Attack 6 + `frost-p2pk-cashu.test.ts` step 7 |
| Matchmaker DoS | Mitigated by Nostr redundancy | (manual; multiple matchmakers + Nostr publish) |

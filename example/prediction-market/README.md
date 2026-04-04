# Prediction Market — Cashu + Nostr + TLSNotary

Bitcoin-native prediction markets using Cashu HTLC for trustless settlement, TLSNotary for oracle resolution, and Nostr for censorship-resistant market discovery.

## Problem

Existing prediction markets (Polymarket, Kalshi) require KYC, custodial deposits, and centralized resolution. They can freeze funds, censor markets, and are geographically restricted.

## Solution

A fully non-custodial prediction market where:

- **Cashu HTLC** escrows bets — no custodial risk, 1 sat minimum bet
- **TLSNotary** resolves outcomes — cryptographic proof from authoritative data sources
- **Nostr** discovers markets — censorship-resistant order book, no centralized server

## How HTLC Settlement Works

```
YES outcome:
  1. YES bettor locks sats in Cashu HTLC (hash = Oracle's hash)
  2. Oracle resolves market via TLSNotary proof
  3. Oracle reveals preimage → YES bettor redeems HTLC
  4. YES bettors split the total pool proportionally

NO outcome:
  1. Same HTLC setup
  2. Oracle resolves market — conditions not met
  3. Oracle withholds preimage
  4. HTLC locktime expires → funds return to refund pool
  5. NO bettors claim their proportional share
```

The Oracle never custodies funds. The HTLC ensures atomic settlement: either the preimage is revealed (YES wins) or the locktime expires (NO wins).

## Resolution via TLSNotary

The Oracle uses TLSNotary to fetch data from authoritative URLs and prove the response content cryptographically. The TLS certificate chain verifies the domain — the Oracle cannot fabricate data.

Supported resolution condition types:

| Type | Description | Example |
|------|-------------|---------|
| `price_above` | Numeric value exceeds threshold | BTC/JPY ltp > 15,000,000 |
| `price_below` | Numeric value below threshold | ETH gas < 10 gwei |
| `contains_text` | Response contains literal text | Page contains "winner: Team A" |
| `jsonpath_equals` | JSONPath value matches string | `status` == "completed" |
| `jsonpath_gt` | JSONPath value > threshold | `score.home` > 3 |
| `jsonpath_lt` | JSONPath value < threshold | `unemployment_rate` < 4.0 |

Example data sources:
- **Crypto prices**: `https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY`
- **Sports scores**: ESPN API, official league APIs
- **Government data**: Bureau of Labor Statistics, election result pages
- **Weather**: OpenWeatherMap, government weather services

## Architecture

```
Market Creator                          Bettors
┌──────────────────┐                    ┌──────────────────┐
│ Define question,  │                    │ Discover market   │
│ conditions, URL   │ ── Nostr ────────▶ │ via Nostr relay   │
│                   │                    │                   │
│ Designate Oracle  │                    │ Lock sats in      │
│ (trusted for      │                    │ Cashu HTLC (YES)  │
│  resolution only) │                    │ or refund pool    │
└──────────────────┘                    │ (NO)              │
                                         └──────────────────┘
                                                  │
                    ┌───────────────┐              │
                    │    Oracle     │◀─────────────┘
                    │               │
                    │ 1. Fetch URL  │
                    │    via TLSNotary
                    │ 2. Evaluate   │
                    │    conditions │
                    │ 3. YES → reveal
                    │    preimage   │
                    │    NO → withhold
                    └───────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              YES bettors    NO bettors
              redeem HTLC    claim refund
              with preimage  after locktime
```

## Nostr Event Kinds

| Kind | Purpose | Tags |
|------|---------|------|
| `30078` | Market creation | `d:marketId`, `t:category`, `t:prediction-market` |
| `30079` | Bet placement | `d:betId`, `e:marketId`, `t:prediction-market-bet` |
| `30080` | Oracle resolution | `d:marketId`, `e:marketId`, `t:prediction-market-resolution`, `outcome:yes\|no\|void` |

## Running the Demo

```bash
# From the repository root
deno run --allow-all example/prediction-market/src/demo.ts

# Or from the example directory
cd example/prediction-market
deno task demo
```

The demo:
1. Creates a BTC/JPY price market (threshold: 15,000,000 JPY)
2. Places simulated YES and NO bets
3. Fetches the live bitFlyer ticker (falls back to simulated data offline)
4. Evaluates conditions against the response
5. Resolves the market and calculates payouts
6. Shows Nostr event structures for market discovery

## Files

- **src/market-types.ts** — TypeScript types for markets, bets, resolutions, conditions
- **src/market-oracle.ts** — TLSNotary-based oracle: condition evaluation, resolution, payout calculation
- **src/nostr-market.ts** — Nostr event builders for market discovery (create, bet, resolve)
- **src/demo.ts** — Runnable demo with live bitFlyer BTC/JPY data

## Threat Analysis

| Threat | Mitigation |
|--------|-----------|
| **Oracle fabricates data** | TLSNotary proves the TLS certificate chain. `server_name` must match `resolutionDomain`. The Oracle cannot forge a response from `api.bitflyer.com`. |
| **Oracle front-runs bets** | Betting deadline is set before resolution. Oracle cannot place bets after seeing the outcome. Use multiple independent Oracles for high-stakes markets. |
| **Stale data** | `maxAttestationAgeSec` limits how old the TLSNotary proof can be (default: 5 minutes). |
| **HTLC preimage leak** | HTLC redemption requires both preimage AND the bettor's Cashu spending key. Preimage alone is insufficient. |
| **Nostr censorship** | Markets are published to multiple relays. Any relay can serve the events. Bettors can use their own relays. |
| **Cashu mint rug** | Use reputable mints with proof of reserves. For large bets, split across multiple mints. |

## Future Extensions

- **Multi-outcome markets** (not just YES/NO) via multiple HTLC branches
- **Continuous markets** with AMM-style pricing (Cashu token pools)
- **Oracle reputation** tracked on Nostr (resolution accuracy score)
- **Market aggregator** UI that subscribes to `#t:prediction-market` events
- **Cross-mint settlement** for markets spanning multiple Cashu mints

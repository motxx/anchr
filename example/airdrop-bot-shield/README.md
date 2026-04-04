# Airdrop Bot Shield

TLSNotary-based Sybil resistance for token airdrops — prove you're human without revealing who you are.

## Problem

Token airdrops are one of the most effective mechanisms for distributing governance tokens to real users. They're also one of the most exploited.

**Real-world damage:**

- **LayerZero (2024)** — Excluded 1.2M wallets (>80% of snapshots) as suspected Sybils. Despite months of self-reporting and cluster analysis, the team still couldn't distinguish all bots from real users.
- **Arbitrum (2023)** — Sybil farmers captured an estimated $5M+ in $ARB. One cluster of wallets bridged minimal amounts across 1,000+ addresses to qualify.
- **Optimism (2023)** — Multiple rounds of airdrop farming operations documented, with professional operations using hundreds of wallets and scripted interactions.
- **Hop Protocol (2022)** — Despite detailed on-chain criteria, coordinated farming operations extracted significant portions of the airdrop allocation.

The core issue: **on-chain behavior is trivially faked**. A bot can bridge tokens, swap on DEXes, and interact with contracts just as cheaply as a real user. Any criteria based solely on on-chain activity can be gamed at scale.

## Solution

Anchr provides a TLSNotary-based proof system where airdrop claimants cryptographically prove attributes from existing Web2 accounts (GitHub, Twitter, etc.) without revealing their identity. Combined with Cashu HTLC escrow for trustless token distribution, this creates a Sybil-resistant airdrop pipeline.

**Key insight:** A GitHub account with 3 years of history, 50+ repos, and 500+ contributions is economically impractical to fake. A Twitter account with 1,000+ organic followers costs far more than an airdrop allocation is worth. TLSNotary lets us verify these attributes cryptographically without requiring users to link their Web2 identity to their wallet.

## How It Works

### 3-Step Flow

```
1. PROJECT defines airdrop criteria
   "GitHub account > 1 year old, > 10 repos, > 100 contributions"

2. CLAIMANT generates TLSNotary proofs
   Visits https://api.github.com/users/{username} in TLSNotary extension
   MPC-TLS session proves the JSON response without revealing it to the verifier

3. VERIFIED CLAIM releases tokens via Cashu HTLC
   Oracle verifies proof → releases preimage → claimant redeems escrowed tokens
```

### Supported Proof Types

| Proof Type | Target URL | JSONPath | What It Proves |
|------------|-----------|----------|----------------|
| GitHub account age | `https://api.github.com/users/{user}` | `created_at` | Account existed before a date |
| GitHub repos | `https://api.github.com/users/{user}` | `public_repos` | User has N+ public repos |
| GitHub contributions | `https://api.github.com/users/{user}` | `public_gists` + commit activity | Active developer |
| Twitter followers | `https://api.x.com/2/users/{id}?user.fields=public_metrics` | `data.public_metrics.followers_count` | Social proof (N+ followers) |

### Architecture

```
Project (token issuer)                   Claimant (wants tokens)
+---------------------+                 +----------------------+
| 1. Define criteria  |                 | 2. Generate proofs   |
|    - GitHub > 1yr   |                 |    per condition     |
|    - 10+ repos      |                 |                      |
|    - 100+ contribs  |                 |  github.com/users/me |
|                     |                 |  -> TLSNotary proof  |
| 3. Lock tokens in   |                 |                      |
|    Cashu HTLC       |                 | 4. Submit proofs     |
|    escrow pool      |                 |    to Anchr          |
+---------------------+                 +----------------------+
         |                                       |
         |             +-----------+             |
         +------------>|   Anchr   |<------------+
                       |   Oracle  |
                       |           |
                       | Verify:   |
                       |  TLS sig  |
                       |  domain   |
                       |  jsonpath |
                       |  freshness|
                       +-----------+
                            |
                   All conditions pass?
                       /         \
                     YES          NO
                      |            |
               Release HTLC    Reject claim
               preimage           |
                      |        Tokens remain
               Claimant         in escrow
               redeems tokens
```

### Cashu HTLC Escrow Pool

The project pre-funds an escrow pool using Cashu HTLC tokens (NUT-14). Each claim generates a unique hash/preimage pair. On successful verification, the oracle releases the preimage, allowing the claimant to redeem their token allocation from the Cashu mint. This is fully non-custodial: the project cannot claw back tokens after escrow, and the oracle cannot steal tokens without the claimant's private key.

```
Project                     Cashu Mint                    Claimant
   |                            |                            |
   |-- Lock 1000 tokens ------->|                            |
   |   (HTLC per claim)        |                            |
   |                            |                            |
   |                            |        Proof verified      |
   |                            |<--- Oracle releases -------|
   |                            |     preimage               |
   |                            |                            |
   |                            |--- Claimant redeems ------>|
   |                            |    with preimage + sig     |
```

## Comparison with Existing Solutions

| | Gitcoin Passport | WorldCoin | On-chain Analysis | **Anchr Bot Shield** |
|---|---|---|---|---|
| **Mechanism** | Stamp collection (social accounts, on-chain) | Iris biometric scan | Wallet clustering, ML | TLSNotary cryptographic proofs |
| **Privacy** | Links Web2 accounts to wallet address | Stores iris hash on-chain | Passive observation | Zero-knowledge: proves attributes without linking identity |
| **Sybil cost** | ~$5 per fake passport (buy aged accounts) | Requires physical presence at Orb | Free (just create more wallets) | Cost of maintaining genuine Web2 accounts |
| **Decentralization** | Gitcoin's stamp servers | WorldCoin Foundation Orbs | Centralized analysis firms | Any TLSNotary verifier + Cashu mint |
| **User experience** | Connect wallet + social accounts | Visit an Orb location | No action required | Generate proof in browser extension |
| **Forgery resistance** | Moderate (stamps can be farmed) | High (biometric) | Low (behavior is fakeable) | High (TLS certificate chain verification) |

### Economic Analysis: Cost to Farm

The key question: how much does it cost to create a fake identity that passes the criteria?

**Typical airdrop criteria and farming costs:**

| Condition | Airdrop value | Farming cost | Ratio |
|-----------|--------------|-------------|-------|
| GitHub account > 365 days | $500 | $50-100 (buy aged account) + risk of ban | 5-10x |
| GitHub > 50 repos | $500 | $200+ (maintain activity over months) | 2.5x |
| GitHub > 500 contributions | $500 | $500+ (sustained commit history) | ~1x |
| Twitter > 1000 followers | $500 | $100-300 (buy followers, but easy to detect) | 1.7-5x |
| **Combined (all above)** | $500 | **$800-1100** | **<1x** |

When conditions are combined, the farming cost exceeds the airdrop value. This makes large-scale Sybil operations economically unprofitable. A farmer would need to spend more on fake accounts than they'd earn from the airdrop.

## API Endpoints

### `POST /airdrop/create`

Create a new airdrop campaign with eligibility criteria.

```json
{
  "name": "Protocol Genesis Airdrop",
  "conditions": [
    {
      "type": "github_account_age",
      "target_url": "https://api.github.com/users/{username}",
      "min_value": 365,
      "jsonpath": "created_at",
      "description": "GitHub account older than 1 year"
    },
    {
      "type": "github_repos",
      "target_url": "https://api.github.com/users/{username}",
      "min_value": 10,
      "jsonpath": "public_repos",
      "description": "At least 10 public repositories"
    }
  ],
  "token_amount_per_claim": 1000,
  "total_budget_sats": 10000000
}
```

### `POST /airdrop/{id}/claim`

Submit TLSNotary proofs to claim airdrop tokens.

```json
{
  "wallet_address": "0x...",
  "proofs": [
    {
      "condition_index": 0,
      "presentation": "<base64-encoded TLSNotary presentation>"
    },
    {
      "condition_index": 1,
      "presentation": "<base64-encoded TLSNotary presentation>"
    }
  ]
}
```

**Response (success):**

```json
{
  "status": "approved",
  "results": [
    { "condition": "github_account_age", "passed": true, "value": 1423 },
    { "condition": "github_repos", "passed": true, "value": 47 }
  ],
  "cashu_token": "cashuA..."
}
```

### `GET /airdrop/{id}/status`

Check airdrop campaign status (remaining budget, total claims, etc.).

```json
{
  "id": "airdrop_01",
  "name": "Protocol Genesis Airdrop",
  "total_budget_sats": 10000000,
  "remaining_budget_sats": 8500000,
  "total_claims": 15,
  "approved_claims": 12,
  "rejected_claims": 3
}
```

## Running the Example

```bash
# From the repository root
deno run --allow-all example/airdrop-bot-shield/src/demo.ts

# Or use the task
cd example/airdrop-bot-shield
deno task demo
```

The demo simulates the full flow with mock data:

1. Creates an airdrop campaign with GitHub-based criteria
2. Shows the TLSNotary proof requests that would be generated
3. Verifies mock proofs against the criteria (simulating what the oracle does)
4. Demonstrates the Cashu HTLC escrow and redemption flow

For a real deployment, you would need:

- **Anchr server** running (`deno task dev` from the repo root)
- **TLSNotary Extension** in the claimant's browser for proof generation
- **Cashu Mint** for HTLC token escrow (e.g., Nutshell at `http://localhost:3338`)

## Files

- **src/airdrop-criteria.ts** — TypeScript types, condition builders, and validation for airdrop eligibility criteria
- **src/claim-verifier.ts** — Verification logic: evaluates TLSNotary proofs against airdrop conditions
- **src/demo.ts** — Runnable demo simulating the full airdrop claim flow with mock data
- **deno.json** — Task definitions for running the example

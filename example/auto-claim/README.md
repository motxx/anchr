# Auto-Claim: Automatic Money Recovery

"Install the extension. Browse normally. Money you're owed comes back automatically."

## Concept

People leave money on the table every day:

- **Flight delayed 3 hours?** EU261 says the airline owes you €250-600. 85% never claim.
- **Price dropped after purchase?** Many stores and credit cards offer price protection. Nobody files.
- **Cloud provider went down?** SLA says you get credits. 99% of customers don't request them.

The friction of filing claims kills recovery. Auto-Claim removes that friction entirely.

## How it works

```
Insurance Provider              User's Browser Extension
  │                                │
  │ "NH123 delay ≥ 120 min         │ User checks flight status
  │  → 10,000 sats"               │ (normal browsing)
  │                                │
  │ POST /queries ──────►  Anchr   │
  │ (bounty created)       │       │
  │                        │   ◄── Extension polls bounties
  │                        │       │
  │                        │       │ fetch(airline API)
  │                        │       │ "status: on_time" → skip
  │                        │       │ "status: on_time" → skip
  │                        │       │ "status: delayed, 185 min" → MATCH
  │                        │       │
  │                        │       │ TLSNotary proof generated
  │                        │       │
  │                   ◄────┼───────│ POST /queries/:id/result
  │                        │       │
  │ Claim approved         │       │ 10,000 sats received
  │ Payout: 10,000 sats    │       │
```

Key difference from monitoring: **the bounty creator is the insurer,
the claimant is the user**. The user earns by proving events that
already entitle them to money.

## Demo

```bash
# Terminal 1: Anchr server
deno task dev

# Terminal 2: Mock airline API (switches to "delayed" after 20s)
deno run --allow-all --env example/auto-claim/mock-airline.ts

# Terminal 3: Insurance provider creates bounty
ANCHR_URL=http://localhost:3000 \
deno run --allow-all --env example/auto-claim/insurer.ts

# Terminal 4: User's auto-claim agent
ANCHR_URL=http://localhost:3000 \
deno run --allow-all --env example/auto-claim/agent.ts
```

Watch the agent output:
```
[12:00:10] NH123 → on_time — no claim
[12:00:20] NH123 → on_time — no claim
[12:00:30] NH123 → delayed (185 min delay) — CLAIM TRIGGERED!
  ✓ status = "delayed" (expected "delayed")
  ✓ regex → "delay_minutes": 185
  Bounty: 10000 sats
  Generating TLSNotary proof...
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANCHR_URL` | `http://localhost:3000` | Anchr server |
| `MOCK_PORT` | `4000` | Mock airline port |
| `AIRLINE_URL` | `http://localhost:4000` | Airline API base URL |
| `DELAY_AFTER_SECONDS` | `20` | Seconds before mock switches to delayed |
| `FLIGHT` | `NH123` | Flight to insure |
| `PAYOUT_SATS` | `10000` | Insurance payout |
| `CHECK_INTERVAL_MS` | `10000` | Agent polling interval |

## Claim types (extensible)

This demo shows flight delay. The same pattern works for:

| Claim type | Target URL | Condition |
|---|---|---|
| Flight delay | Airline status API | `jsonpath: status = "delayed"` |
| Price drop | E-commerce product page | `regex: price < previous` |
| SLA violation | Cloud status page | `contains: "Service disruption"` |
| Subscription error | Billing portal | `contains: "charged"` after cancellation |
| Delivery delay | Tracking API | `jsonpath: estimated_delivery > promised` |

Each claim type is just a different bounty with different conditions.
No code changes needed — only the bounty definition changes.

## vs. ポイ活

| | ポイ活 | Auto-Claim |
|---|---|---|
| What you earn | Points (limited, expiring) | **Bitcoin** |
| How you earn | Click ads, fill surveys | **Browse normally** |
| Who pays | Advertisers | **Entities that already owe you** |
| Trust model | Platform self-reports | **TLSNotary proof** |
| User effort | Active tasks | **Zero** (extension handles it) |

# Auto-Claim

> **Status: Concept.** Browser extension is the target UX; the current demo runs
> the same agent logic as a Deno script. No extension is shipping yet.
> The Deno scripts are developer fixtures for the protocol shape, not a
> maintained Testnet reference flow.

> **Uses:** `anchr-sdk` Customer / Provider primitives, Nostr, Cashu HTLC,
> TLSNotary, and an Oracle. No Anchr-operated host or reference `/queries`
> server is required. **Pattern:** bounty (Insurer pays Claimant on verified
> TLSN proof of triggering event).

"Install the extension. Browse normally. Money you're owed comes back
automatically."

> **Anchr role mapping.** The bounty creator (Insurer) is the **Requester**; the
> **Claimant** — anyone owed money under that policy — is the **Worker** who
> proves the trigger occurred. The Oracle verifies and releases the HTLC.

> The browser extension is the target UX. The demo below runs the same agent
> logic as a Deno script — no extension is shipping yet.

## Completion Target

This example intentionally remains `Concept`.

The repository keeps the insurer and agent scripts to show the Customer/Provider
role mapping, predicate shape, and TLSNotary proof handoff. It does not yet
ship the expected browser extension, extension permission model, TLSNotary
browser integration, or smoke harness needed for a reproducible Testnet flow.

To graduate from `Concept`, a future issue should add:

- a browser extension or equivalent browser automation entry point;
- a non-secret local runbook for relay, mint, Oracle, notary, and verifier
  services;
- a fixture-backed smoke command that catches SDK/API drift without requiring
  real claimant credentials;
- explicit privacy and permission notes for the pages the agent can observe.

## Concept

People leave money on the table every day:

- **Flight delayed 3 hours?** EU261 says the airline owes you €250-600. 85%
  never claim.
- **Price dropped after purchase?** Many stores and credit cards offer price
  protection. Nobody files.
- **Cloud provider went down?** SLA says you get credits. 99% of customers don't
  request them.

The friction of filing claims kills recovery. Auto-Claim removes that friction
entirely.

## How it works

```
Insurance Provider              User's Browser Extension
  │                                │
  │ "NH123 delay ≥ 120 min         │ User checks flight status
  │  → 10,000 sats"               │ (normal browsing)
  │                                │
  │ kind 5300 request ───► Nostr   │
  │ + Cashu HTLC          relay    │   ◄── Extension receives request
  │                        │       │
  │ ◄──── kind 7000 offer ─┼────── │
  │ kind 7000 selection ─► │       │
  │                        │       │ fetch(airline API)
  │                        │       │ "status: on_time" → skip
  │                        │       │ "status: on_time" → skip
  │                        │       │ "status: delayed, 185 min" → MATCH
  │                        │       │
  │                        │       │ TLSNotary proof generated
  │                        │       │
  │                   ◄────┼───────│ kind 6300 encrypted result
  │                        │       │ Oracle DMs preimage
  │ Claim approved         │       │ 10,000 sats received
  │ Payout: 10,000 sats    │       │
```

Key difference from monitoring: **the bounty creator is the insurer, the
claimant is the user**. The user earns by proving events that already entitle
them to money.

## Demo

```bash
# Terminal 1: local relay, mint, and your chosen Oracle
docker compose up -d

# Terminal 2: Mock airline API (switches to "delayed" after 20s)
deno run --allow-all --env examples/auto-claim/mock-airline.ts

# Terminal 3: User's auto-claim Provider
NOSTR_RELAYS=ws://localhost:7777 \
CASHU_MINT_URL=http://localhost:3338 \
ORACLE_PUBKEY=<oracle-pubkey-hex> \
AUTO_CLAIM_PROVIDER_PRIVKEY=<provider-nsec-or-hex> \
deno run --allow-all --env examples/auto-claim/agent.ts

# Terminal 4: Insurance provider / Customer creates the request
NOSTR_RELAYS=ws://localhost:7777 \
CASHU_MINT_URL=http://localhost:3338 \
ORACLE_ENDPOINT=http://localhost:3001 \
ORACLE_PUBKEY=<oracle-pubkey-hex> \
AUTO_CLAIM_SOURCE_PROOFS_JSON='[...]' \
deno run --allow-all --env examples/auto-claim/insurer.ts
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

| Variable                        | Default                 | Description                             |
| ------------------------------- | ----------------------- | --------------------------------------- |
| `NOSTR_RELAYS`                  | `ws://localhost:7777`   | Relay URLs                              |
| `CASHU_MINT_URL`                | required                | Cashu mint URL                          |
| `ORACLE_ENDPOINT`               | required for Customer   | Oracle hash endpoint                    |
| `ORACLE_PUBKEY`                 | required                | Oracle Nostr pubkey                     |
| `AUTO_CLAIM_SOURCE_PROOFS_JSON` | required for Customer   | Cashu proofs to lock                    |
| `AUTO_CLAIM_PROVIDER_PRIVKEY`   | required for Provider   | Provider Nostr secret key               |
| `MOCK_PORT`                     | `4000`                  | Mock airline port                       |
| `AIRLINE_URL`                   | `http://localhost:4000` | Airline API base URL                    |
| `DELAY_AFTER_SECONDS`           | `20`                    | Seconds before mock switches to delayed |
| `FLIGHT`                        | `NH123`                 | Flight to insure                        |
| `PAYOUT_SATS`                   | `10000`                 | Insurance payout                        |
| `CHECK_INTERVAL_MS`             | `10000`                 | Agent polling interval                  |

## Claim types (extensible)

This demo shows flight delay. The same pattern works for:

| Claim type         | Target URL              | Condition                                 |
| ------------------ | ----------------------- | ----------------------------------------- |
| Flight delay       | Airline status API      | `jsonpath: status = "delayed"`            |
| Price drop         | E-commerce product page | `regex: price < previous`                 |
| SLA violation      | Cloud status page       | `contains: "Service disruption"`          |
| Subscription error | Billing portal          | `contains: "charged"` after cancellation  |
| Delivery delay     | Tracking API            | `jsonpath: estimated_delivery > promised` |

Each claim type is just a different bounty with different conditions. No code
changes needed — only the bounty definition changes.

## vs. ポイ活

|                 | ポイ活                     | Auto-Claim                        |
| --------------- | -------------------------- | --------------------------------- |
| What you earn   | Points (limited, expiring) | **Bitcoin**                       |
| How you earn    | Click ads, fill surveys    | **Browse normally**               |
| Who pays        | Advertisers                | **Entities that already owe you** |
| Trust model     | Platform self-reports      | **TLSNotary proof**               |
| Claimant effort | Active tasks               | **Zero** (extension handles it)   |

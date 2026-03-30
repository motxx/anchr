# TLSNotary Fiat Swap

Trustless fiat-to-Bitcoin exchange using [TLSNotary](https://tlsnotary.org/) proofs and Cashu HTLC escrow — no centralized exchange required.

## Problem

Peer-to-peer fiat ↔ Bitcoin trades require trust: after the buyer sends fiat, the seller might not release BTC (or vice versa). Centralized exchanges solve this with KYC and custodial escrow, but at the cost of privacy and censorship resistance.

## Solution

Anchr enables **trustless P2P on-ramp** by combining:

- **TLSNotary** — Cryptographic proof that a Stripe payment was completed, without revealing the full page content
- **Cashu HTLC** — Hash Time-Locked Contract escrow on Bitcoin/Lightning via ecash, ensuring atomic settlement

The buyer pays via a Stripe Payment Link, then generates a TLSNotary attestation of the Stripe receipt page. Anchr's oracle verifies the proof and releases the HTLC preimage, allowing the buyer to redeem the escrowed BTC.

## Why Stripe?

- Stripe offers a [Crypto Onramp](https://stripe.com/use-cases/crypto) product — no ToS conflict with crypto-related usage
- Payment Links provide a simple, hosted checkout flow
- Receipt pages on `checkout.stripe.com` are standard HTTPS — ideal for TLSNotary proofs
- Clear "succeeded" status on receipts makes condition matching straightforward

## Comparison with zkP2P

| | [zkP2P](https://zkp2p.xyz/) | Anchr TLSNotary Fiat Swap |
|---|---|---|
| Proof system | ZK-SNARK (circom) | TLSNotary (MPC-TLS) |
| Data source | Venmo email receipts | Any HTTPS page (Stripe, bank portals, etc.) |
| Settlement | Ethereum smart contract | Cashu HTLC (Bitcoin/Lightning) |
| Infrastructure | On-chain (Ethereum) | Nostr relay + Cashu mint |
| Privacy | ZK proof reveals nothing | Selective disclosure of page content |

## Architecture

```
Seller (has BTC)                         Buyer (has fiat)
┌──────────────────┐                     ┌──────────────────┐
│ Lock 100k sats   │                     │ Pay $70 via      │
│ in Cashu HTLC    │                     │ Stripe Payment   │
│                  │                     │ Link             │
│ Create Anchr     │  ── Nostr ──▶       │ Generate TLSNotary│
│ query with       │                     │ proof of Stripe  │
│ conditions       │                     │ receipt page     │
└──────────────────┘                     └──────────────────┘
         │                                        │
         │              ┌───────────┐             │
         └─────────────▶│  Oracle   │◀────────────┘
                        │           │
                        │ 1. TLSNotary signature     │
                        │ 2. Domain = checkout.stripe │
                        │    .com                     │
                        │ 3. Body has "succeeded"     │
                        │ 4. Body has "$70.00"        │
                        │ 5. Body has payment_intent  │
                        │ 6. Attestation fresh        │
                        └───────────┘
                              │
                        Release HTLC preimage
                              │
                              ▼
                     Buyer redeems 100k sats
```

## Flow

### Phase 1: Order Creation

The seller creates a Stripe Payment Link for the fiat amount, locks BTC in a Cashu HTLC escrow, and creates an Anchr query specifying what constitutes valid proof of payment.

```
Seller → Stripe: Create Payment Link ($70.00)
Seller → Cashu Mint: Lock 100k sats (HTLC, preimage held by Oracle)
Seller → Anchr: Create query {
  target_url: "https://checkout.stripe.com/c/pay/{session_id}",
  conditions: ["succeeded", "$70.00", "pi_{payment_intent_id}"],
  max_attestation_age_seconds: 600
}
Anchr → Nostr: Broadcast order
```

### Phase 2: Fiat Payment

The buyer pays via the Stripe Payment Link (credit card, Apple Pay, Google Pay, etc.). This happens entirely off-chain — no crypto involved yet.

### Phase 3: Payment Proof

The buyer opens the Stripe receipt page in a TLSNotary-enabled browser extension. The MPC-TLS protocol generates a cryptographic attestation proving the page content without revealing it to the verifier during the TLS session.

```
Buyer → Stripe: Open receipt page
Buyer → TLSNotary Verifier: MPC-TLS session
Buyer → Anchr: Submit .presentation.tlsn proof
```

### Phase 4: Verification & Settlement

Anchr's oracle verifies the TLSNotary proof and checks all conditions. If everything passes, it releases the HTLC preimage.

```
Oracle: Verify TLSNotary signature ✓
Oracle: server_name === "checkout.stripe.com" ✓
Oracle: body contains "succeeded" ✓
Oracle: body contains "$70.00" ✓
Oracle: body contains "pi_{payment_intent_id}" ✓
Oracle: attestation age < 600s ✓
Oracle → Buyer: Release HTLC preimage
Buyer → Cashu Mint: Redeem 100k sats with preimage + signature
```

## Threat Analysis

| Threat | Mitigation |
|--------|-----------|
| **Buyer fakes Stripe page** | TLSNotary verifies the TLS certificate chain. `server_name` must be `checkout.stripe.com` — a fake server would have a different certificate |
| **Buyer replays old transaction** | `max_attestation_age_seconds` enforces freshness. The attestation timestamp is part of the cryptographic proof |
| **Seller withdraws BTC after payment** | Cashu HTLC: funds cannot be unlocked without the preimage. The seller cannot access the escrowed funds |
| **Oracle steals via preimage** | HTLC redemption requires both the preimage AND the buyer's signature. The oracle alone cannot redeem |
| **Stripe chargeback** | Out of scope for TLSNotary. The seller accepts chargeback risk. Mitigation: wait for settlement period before releasing large amounts |
| **Buyer never submits proof** | HTLC locktime expires → seller reclaims funds automatically |

## Running the Example

```bash
# Start the Anchr server
bun run dev

# Terminal 1: Seller creates an on-ramp order
bun run example/tlsn-fiat-swap/seller.ts

# Terminal 2: Buyer finds the order and gets instructions
bun run example/tlsn-fiat-swap/buyer.ts
```

### Full Flow (requires TLSNotary infrastructure)

For actual TLSNotary proof generation, you need:

1. **TLSNotary Verifier Server** — Runs the MPC-TLS verifier
   ```bash
   docker run -p 7047:7047 ghcr.io/tlsnotary/tlsn-verifier:latest
   ```

2. **TLSNotary Browser Extension** — [TLSN Extension](https://github.com/tlsnotary/tlsn-extension) for capturing proofs

3. **Anchr Worker** — Automates proof generation
   ```bash
   bun run src/auto-worker.ts
   ```

## Files

- **seller.ts** — BTC seller SDK demo: creates a Stripe Payment Link order with Cashu HTLC escrow and TLSNotary conditions
- **buyer.ts** — BTC buyer SDK demo: discovers orders, shows the proof submission flow

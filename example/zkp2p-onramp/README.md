# zkP2P On-ramp

Trustless fiat-to-Bitcoin exchange using [TLSNotary](https://tlsnotary.org/) proofs and Cashu HTLC escrow — no centralized exchange required.

## Problem

Peer-to-peer fiat ↔ Bitcoin trades require trust: after the buyer sends fiat, the seller might not release BTC (or vice versa). Centralized exchanges solve this with KYC and custodial escrow, but at the cost of privacy and censorship resistance.

## Solution

Anchr enables **trustless P2P on-ramp** by combining:

- **TLSNotary** — Cryptographic proof that a PayPal/Venmo payment was completed, without revealing the full page content
- **Cashu HTLC** — Hash Time-Locked Contract escrow on Bitcoin/Lightning via ecash, ensuring atomic settlement

The buyer proves they sent fiat by generating a TLSNotary attestation of the PayPal transaction page. Anchr's oracle verifies the proof and releases the HTLC preimage, allowing the buyer to redeem the escrowed BTC.

## Comparison with zkP2P

| | [zkP2P](https://zkp2p.xyz/) | Anchr zkP2P |
|---|---|---|
| Proof system | ZK-SNARK (circom) | TLSNotary (MPC-TLS) |
| Data source | Venmo email receipts | Any HTTPS page (PayPal, Venmo, bank portals) |
| Settlement | Ethereum smart contract | Cashu HTLC (Bitcoin/Lightning) |
| Infrastructure | On-chain (Ethereum) | Nostr relay + Cashu mint |
| Privacy | ZK proof reveals nothing | Selective disclosure of page content |

## Architecture

```
Seller (has BTC)                         Buyer (has fiat)
┌──────────────────┐                     ┌──────────────────┐
│ Lock 100k sats   │                     │ Send $70 via     │
│ in Cashu HTLC    │                     │ PayPal           │
│                  │                     │                  │
│ Create Anchr     │  ── Nostr ──▶       │ Generate TLSNotary│
│ query with       │                     │ proof of PayPal  │
│ conditions       │                     │ transaction page │
└──────────────────┘                     └──────────────────┘
         │                                        │
         │              ┌───────────┐             │
         └─────────────▶│  Oracle   │◀────────────┘
                        │           │
                        │ 1. TLSNotary signature  │
                        │ 2. Domain = paypal.com  │
                        │ 3. Body has "Completed" │
                        │ 4. Body has "$70.00"    │
                        │ 5. Body has seller email│
                        │ 6. Attestation fresh    │
                        └───────────┘
                              │
                        Release HTLC preimage
                              │
                              ▼
                     Buyer redeems 100k sats
```

## Flow

### Phase 1: Order Creation

The seller locks BTC in a Cashu HTLC escrow and creates an Anchr query specifying what constitutes valid proof of payment.

```
Seller → Cashu Mint: Lock 100k sats (HTLC, preimage held by Oracle)
Seller → Anchr: Create query {
  target_url: "https://www.paypal.com/activity/payment/{txId}",
  conditions: ["Completed", "$70.00", "seller@example.com"],
  max_attestation_age_seconds: 600
}
Anchr → Nostr: Broadcast order
```

### Phase 2: Fiat Payment

The buyer sends fiat via PayPal. This happens entirely off-chain — no crypto involved yet.

### Phase 3: Payment Proof

The buyer opens the PayPal transaction page in a TLSNotary-enabled browser extension. The MPC-TLS protocol generates a cryptographic attestation proving the page content without revealing it to the verifier during the TLS session.

```
Buyer → PayPal: Open transaction page
Buyer → TLSNotary Verifier: MPC-TLS session
Buyer → Anchr: Submit .presentation.tlsn proof
```

### Phase 4: Verification & Settlement

Anchr's oracle verifies the TLSNotary proof and checks all conditions. If everything passes, it releases the HTLC preimage.

```
Oracle: Verify TLSNotary signature ✓
Oracle: server_name === "www.paypal.com" ✓
Oracle: body contains "Completed" ✓
Oracle: body contains "$70.00" ✓
Oracle: body contains "seller@example.com" ✓
Oracle: attestation age < 600s ✓
Oracle → Buyer: Release HTLC preimage
Buyer → Cashu Mint: Redeem 100k sats with preimage + signature
```

## Threat Analysis

| Threat | Mitigation |
|--------|-----------|
| **Buyer fakes PayPal page** | TLSNotary verifies the TLS certificate chain. `server_name` must be `www.paypal.com` — a fake server would have a different certificate |
| **Buyer replays old transaction** | `max_attestation_age_seconds` enforces freshness. The attestation timestamp is part of the cryptographic proof |
| **Seller withdraws BTC after payment** | Cashu HTLC: funds cannot be unlocked without the preimage. The seller cannot access the escrowed funds |
| **Oracle steals via preimage** | HTLC redemption requires both the preimage AND the buyer's signature. The oracle alone cannot redeem |
| **PayPal reverses the transaction** | Out of scope for TLSNotary. The seller accepts PayPal's dispute policy risk. Mitigation: use payment methods with finality |
| **Buyer never submits proof** | HTLC locktime expires → seller reclaims funds automatically |

## Running the Example

```bash
# Start the Anchr server
bun run dev

# Terminal 1: Seller creates an on-ramp order
bun run example/zkp2p-onramp/seller.ts

# Terminal 2: Buyer finds the order and gets instructions
bun run example/zkp2p-onramp/buyer.ts
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

- **seller.ts** — BTC seller SDK demo: creates an on-ramp order with Cashu HTLC escrow and TLSNotary conditions
- **buyer.ts** — BTC buyer SDK demo: discovers orders, shows the proof submission flow

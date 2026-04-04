# Supply Chain Proof

Tamper-proof supply chain records using Anchr's GPS verification, C2PA, TLSNotary, and Cashu HTLC technology.

## Problem

Global supply chain fraud is a trillion-dollar problem:

- **Food fraud** costs an estimated **$40 billion/year** globally (FDA, Europol). Olive oil, honey, coffee, and seafood are the most commonly adulterated products. Consumers and importers have no way to independently verify origin claims.
- **Counterfeit goods** exceed **$500 billion/year** (OECD). Luxury goods, electronics, and pharmaceuticals are routinely counterfeited, with fakes entering legitimate supply chains undetected.
- **Pharmaceutical cold chain** failures cause **$35 billion/year** in losses (IQVIA). Temperature-sensitive drugs like vaccines and biologics lose efficacy when the cold chain breaks, but paper-based temperature logs are easily falsified.

The core issue: every existing supply chain verification system relies on **self-reported data** and **trusted intermediaries**. There is no cryptographic guarantee that a product was actually at the claimed location, that the logistics API data was not fabricated, or that the payments were conditional on verification.

## Solution

Anchr's technology stack maps directly to the four trust problems in supply chains:

| Trust Problem | Anchr Technology | What It Proves |
|---|---|---|
| "Was the product physically here?" | **GPS + C2PA** | Hardware-signed photo with embedded GPS coordinates. The camera's secure enclave signs the image — GPS cannot be spoofed without breaking the cryptographic signature. |
| "Is the logistics data real?" | **TLSNotary** | MPC-TLS proof that the shipping API, customs system, or temperature sensor returned specific data. The proof is cryptographically bound to the TLS session — the data cannot be fabricated after the fact. |
| "Will payment happen fairly?" | **Cashu HTLC** | Hash Time-Locked Contract escrow on Bitcoin/Lightning via ecash. Payment releases only when the oracle verifies the next step's proofs. No trusted escrow agent needed. |
| "Can anyone audit the chain?" | **Nostr** | Every step is published as a Nostr event. Anyone with the product ID can reconstruct and verify the full chain. No central database to tamper with. |

## Use Cases

### 1. Coffee: Farm to Cup

A specialty coffee lot travels from Brazil to Japan:

```
Farm (Sao Paulo) -> Port (Santos) -> Ship -> Port (Yokohama) -> Roaster (Kawasaki) -> Cafe (Shibuya)
```

At each step:
- The **farmer** photographs the harvest with a C2PA camera. GPS proves the beans came from the claimed farm, not a cheaper plantation.
- The **exporter** proves via TLSNotary that the Maersk tracking API shows the correct container was loaded at Santos.
- The **roaster** photographs arrival at the Kawasaki facility (GPS + C2PA) and proves via TLSNotary that the SCA cupping score exceeds 80 (specialty grade).
- The **cafe** confirms final delivery with a GPS-verified photo in Shibuya.

Each step releases a Cashu HTLC payment to the previous actor. The farmer gets paid only after the exporter verifies receipt; the exporter gets paid only after the roaster verifies quality.

### 2. Pharmaceuticals: Manufacturing to Pharmacy

```
Factory (Basel) -> Cold Storage (Frankfurt) -> Air Freight -> Distribution (Tokyo) -> Pharmacy (Osaka)
```

- **C2PA** photos prove physical handling at each facility.
- **TLSNotary** proves temperature sensor API logs stayed within 2-8C throughout cold storage and transport. If the cold chain broke, the proof fails and payment is withheld.
- **Cashu HTLC** ensures the distribution company only gets paid if temperature conditions were maintained.

### 3. Luxury Goods: Workshop to Retail

```
Workshop (Florence) -> Authentication Center (Milan) -> Shipping -> Retail (Ginza, Tokyo)
```

- **C2PA** photos with serial number close-ups prove physical inspection at the authentication center.
- **TLSNotary** proves the brand's authentication API confirms the serial number is genuine and not previously flagged.
- **GPS** proves the item was physically at each claimed location, preventing "ghost routing" through cheaper jurisdictions.

## Architecture

```
Producer                 Logistics               Processor               Retailer
(Farm/Factory)           (Shipper)               (Roaster/Warehouse)     (Cafe/Pharmacy)
     |                       |                        |                       |
     | C2PA photo            | TLSNotary proof        | C2PA photo            | GPS photo
     | + GPS                 | (shipping API)         | + GPS                 |
     |                       |                        | + TLSNotary           |
     v                       v                        v                       v
+----------+  link    +----------+  link    +----------+  link    +----------+
| Step 1   |--------->| Step 2   |--------->| Step 3   |--------->| Step 4   |
| origin   |          | transport|          |processing|          | retail   |
+----------+          +----------+          +----------+          +----------+
     |                       |                        |                       |
     | Nostr event           | Nostr event            | Nostr event           | Nostr event
     v                       v                        v                       v
+--------------------------------------------------------------------------+
|                        Nostr Relay (audit log)                            |
+--------------------------------------------------------------------------+
     |                       |                        |                       |
     v                       v                        v                       v
+--------------------------------------------------------------------------+
|                     Anchr Oracle Verification                             |
|   - C2PA signature chain valid?                                          |
|   - GPS within expected range?                                           |
|   - TLSNotary attestation valid? (domain, body, freshness)              |
|   - Temperature within bounds?                                           |
+--------------------------------------------------------------------------+
     |                       |                        |                       |
     v                       v                        v                       v
+--------------------------------------------------------------------------+
|                     Cashu HTLC Settlement                                 |
|   Step verified -> preimage released -> actor redeems sats from mint     |
+--------------------------------------------------------------------------+
```

## Data Flow for a Single Step

```
Actor Device                   Anchr Server              Cashu Mint
     |                              |                         |
     |  1. Take C2PA photo          |                         |
     |  2. Collect GPS coords       |                         |
     |  3. (optional) TLSNotary     |                         |
     |     proof of API data        |                         |
     |                              |                         |
     |  POST /steps                 |                         |
     |  { proofs, previous_step }   |                         |
     |----------------------------->|                         |
     |                              |                         |
     |                              |  Oracle verifies:       |
     |                              |  - C2PA chain           |
     |                              |  - GPS haversine        |
     |                              |  - TLSNotary sig        |
     |                              |  - Time ordering        |
     |                              |                         |
     |                              |  If passed:             |
     |                              |  Release HTLC preimage  |
     |                              |------------------------>|
     |                              |                         |  Unlock sats
     |  { verified: true,           |                         |
     |    preimage: "abc123..." }   |                         |
     |<-----------------------------|                         |
     |                              |                         |
     |  Redeem HTLC token           |                         |
     |----------------------------------------------->------->|
     |                              |                         |  Sats sent
```

## API Design

### Create a supply chain product

```
POST /supply-chain/products
```

```json
{
  "name": "Fazenda Boa Vista - Lot 2026-03",
  "category": "coffee",
  "verification_requirements": [
    {
      "step_type": "origin",
      "required_proofs": [
        {
          "proof_type": "gps_photo",
          "conditions": [
            { "field": "distance_km", "operator": "within_km", "value": 50 }
          ]
        },
        {
          "proof_type": "c2pa_media",
          "conditions": []
        }
      ],
      "payment_condition": {
        "amount_sats": 5000,
        "release_on_verification": true
      }
    }
  ]
}
```

### Submit a supply chain step

```
POST /supply-chain/products/{product_id}/steps
```

```json
{
  "step_type": "origin",
  "actor": {
    "name": "Fazenda Boa Vista",
    "pubkey": "a1b2c3..."
  },
  "location": {
    "lat": -23.5505,
    "lon": -46.6333,
    "name": "Coffee Farm, Sao Paulo"
  },
  "proofs": [
    {
      "type": "gps_photo",
      "data": {
        "lat": -23.5510,
        "lon": -46.6340,
        "photo_hash": "sha256:a3f8c0d1..."
      }
    },
    {
      "type": "c2pa_media",
      "data": {
        "signer": "ProofMode Camera",
        "signature_time": 1743724800
      }
    }
  ],
  "previous_step_id": null
}
```

### Verify a product's full chain

```
GET /supply-chain/products/{product_id}/verify
```

Response:

```json
{
  "product_id": "coffee-fazenda-lot-2026-03",
  "trust_score": 100,
  "chain_intact": true,
  "time_ordered": true,
  "step_results": [
    {
      "step_id": "step-001-origin",
      "step_type": "origin",
      "verdict": "pass",
      "proof_results": [
        {
          "proof_type": "gps_photo",
          "passed": true,
          "details": "GPS verified: -23.5510, -46.6340 is 0.1km from farm"
        }
      ]
    }
  ],
  "total_sats_released": 11000
}
```

### Get a product's Nostr event trail

```
GET /supply-chain/products/{product_id}/events
```

Returns all Nostr event IDs for independent verification by any relay client.

## Economic Analysis

### Cost of fraud vs. cost of verification

| | Food Fraud (coffee) | Pharma Cold Chain | Luxury Counterfeit |
|---|---|---|---|
| **Annual fraud cost** | $40B globally | $35B globally | $500B+ globally |
| **Per-unit fraud cost** | $2-50/kg (adulteration margin) | $100-10,000/unit (spoiled drugs) | $50-5,000/unit (fake margin) |
| **Anchr verification cost** | ~100 sats/step (~$0.07) | ~100 sats/step (~$0.07) | ~100 sats/step (~$0.07) |
| **Steps per product** | 4-6 | 4-8 | 3-5 |
| **Total verification cost** | $0.28-0.42/product | $0.28-0.56/product | $0.21-0.35/product |
| **ROI** | 100-1,000x | 1,000-100,000x | 500-50,000x |

At current Bitcoin prices (~$70,000), 100 sats is approximately $0.07 USD. A full 4-step coffee supply chain verification costs under $0.30 — less than 0.1% of the retail price of specialty coffee ($15-30/bag).

### Why this works economically

1. **Proof cost is near-zero** compared to fraud cost. Cryptographic verification on commodity hardware costs fractions of a cent.
2. **Cashu HTLC eliminates escrow counterparty risk**. No bank, no PayPal, no intermediary taking 2-5% — just math.
3. **Nostr relay hosting is cheap**. A single relay can store millions of supply chain events for under $20/month.
4. **C2PA cameras are shipping now**. Samsung, Sony, Nikon, and Leica all ship C2PA-capable devices. ProofMode (Guardian Project) makes any Android phone a C2PA camera.

## Running the Demo

### Prerequisites

- [Deno](https://deno.land/) v2+

### Run the coffee demo

```bash
deno task demo:coffee
```

This runs a simulated coffee supply chain (Sao Paulo -> Santos -> Kawasaki -> Shibuya) with pre-populated proofs and prints a full verification report.

### Example output

```
  Supply Chain Proof — Coffee Demo
  Sao Paulo -> Santos -> Kawasaki -> Shibuya

  [ORIGIN    ] Coffee Farm, Sao Paulo, Brazil
    Actor:  Fazenda Boa Vista
    Proofs: gps_photo, c2pa_media

  [TRANSPORT ] Port of Santos, Brazil
    Actor:  Santos Export Co.
    Proofs: tlsn_api

  [PROCESSING] Roastery, Kawasaki, Japan
    Actor:  Tokyo Roast Lab
    Proofs: gps_photo, tlsn_api

  [RETAIL    ] Cafe, Shibuya, Tokyo, Japan
    Actor:  Shibuya Coffee Stand
    Proofs: gps_photo

  Trust Score:    100/100
  Chain Intact:   YES
  Time Ordered:   YES
  Sats Released:  11,000
```

## Files

- **src/supply-chain-types.ts** -- Type definitions for supply chain steps, proofs, products, requirements, and verification reports
- **src/chain-verifier.ts** -- Verification engine: checks proofs, chain integrity, time ordering, and calculates trust scores
- **src/demo-coffee.ts** -- Runnable demo tracing a coffee lot from a Sao Paulo farm to a Shibuya cafe
- **deno.json** -- Deno configuration with tasks

## How This Maps to Anchr's Core

| Example Module | Anchr Core Module | Purpose |
|---|---|---|
| `StepProof.gps_photo` | `GpsCoord` + `haversineKm()` in `src/domain/` | GPS proximity verification |
| `StepProof.c2pa_media` | C2PA validation in `src/infrastructure/verification/` | Content Credential chain verification |
| `StepProof.tlsn_api` | `TlsnVerifiedData` + oracle in `src/infrastructure/oracle/` | TLSNotary MPC-TLS proof verification |
| `PaymentCondition` | `HtlcInfo` + Cashu in `src/infrastructure/` | Conditional HTLC payment release |
| `nostr_event_id` | Nostr relay integration in `src/infrastructure/` | Decentralized audit log |

# Supply Chain Proof

> **Uses:** `@anchr/photo-bounty` + `@anchr/tlsn-toolkit` (designed; current code is a simulation).
> **Does not use:** `@anchr/cashu-conditional-swap` — supply-chain settlement is off-protocol (fiat invoices, bank transfers).
> **Pattern:** verification-only evidence chain (third composition, see [`docs/architecture.md`](../../docs/architecture.md)).

> Conceptual foundation: what problem class this addresses, how Anchr's
> primitives compose recursively, what the combination with adjacent
> attestation tech (C2PA, ProofMode, hardware-signed sensors, per-item
> IDs) achieves, and what Anchr alone fundamentally cannot solve.

> **Status: Sketch.** `src/` contains a typed verification engine and
> a runnable demo with **simulated proofs** (no real C2PA capture,
> TLSNotary fetch, or Nostr publish). The conceptual structure
> described below is what the wired-up version
> aims to demonstrate; runnable end-to-end code will follow once the
> conceptual framing stabilises.

## The shape this addresses

"Multi-step, multi-actor chain of attestations" — every step in a
process is claimed by some actor, each claim could be wrong or forged,
and the next step depends on the previous step being trustworthy.

Today these chains run on self-reported data routed through trusted
intermediaries (auditors, regulators, brand inspectors, paper trails).
Each hop is forgeable on its own, and verification is partial,
expensive, and after the fact.

Physical goods are the obvious case (farm → port → roaster → cafe), but
the same shape recurs in:

- **News provenance** — photographer → desk → editor → publication
- **Digital media licensing** — creator → DAM → distributor → consumer
- **Document authenticity chains** — notary → registrar → counterparty
- **Conditional delivery contracts** — logistics, energy, agriculture
- **Compliance audit trails** — production → testing → certification → shipment

Anchr addresses the **cryptographic verification layer** of this shape:
making each hop produce an unforgeable attestation and gating payment
on its validity.

## What Anchr brings

### 1. The Requester / Worker / Oracle triple — applied recursively

At every hop in the chain, the same triple appears:

- **Requester** — the *next* (downstream) actor; they want proof that
  the previous step happened correctly
- **Worker** — the *previous* (upstream) actor; they produce the proof
- **Oracle** — verifies the proof and releases the HTLC preimage

A 6-step coffee chain (farm → port → ship → port → roaster → cafe) is
just **5 instances of the same triple stacked**, with each hop's Nostr
event linking to the previous hop's verification. The same primitive is
reused at every layer; the chain auditability is emergent.

```
[Farmer]──proof──►[Exporter]──proof──►[Carrier]──proof──►[Roaster]──proof──►[Cafe]
   │         ▲       │           ▲       │          ▲        │         ▲
   └─Oracle──┘       └──Oracle───┘       └──Oracle──┘        └─Oracle──┘
   (verify hop 1)    (verify hop 2)      (verify hop 3)      (verify hop 4)
```

### 2. The bilateral cross-lock for atomic hop-by-hop settlement

Each hop's payment is locked at the Cashu Mint with the downstream
actor's pubkey and the verification's outcome hash. Payment releases
only when verification passes. Funds never enter Anchr's wallet.

### 3. The Nostr event log for chain audit

Each hop publishes a Nostr event referencing the previous hop's event.
Anyone holding the chain's product ID can walk back through the events
and verify each one independently. No central registry to capture,
censor, or rewrite.

## What the composition with adjacent attestation tech achieves

Anchr's primitives are deliberately **weak on their own**. TLSNotary
proves an API returned a value. Cashu HTLC gates payment on a preimage.
Nostr stores events. None of these touch the physical world.

The power comes from **composition with attestation tech that *does*
touch the physical world** — and Anchr's role is the verification +
settlement layer that ties them together:

| When Anchr is composed with… | The chain can prove… |
|---|---|
| **C2PA hardware-rooted cameras** (Sony A1, Nikon Z6III, Leica M11-P, Samsung) | "A signing camera captured this scene at this GPS at this signed timestamp" — the photo itself becomes a tamper-evident attestation, and Anchr's cross-lock binds payment to its on-Oracle verification |
| **ProofMode** (Guardian Project) | Brings C2PA-equivalent attestation to commodity Android phones — every field worker becomes a verifiable Worker without specialised hardware |
| **TLSNotary on first-party APIs** (where the actor has legitimate API access) | The actor's own carrier/customs/sensor API responses become verifiable to any third-party Oracle, **without the API owner needing to integrate with Anchr** |
| **Hardware-signed sensors** (TPM-backed, secure-enclave-attested) | Temperature/humidity/shock readings signed by hardware → composed proof binds *physical state* (not just *reported state*) to payment |
| **Per-item physical IDs** (NFC, RFID, tamper-evident seals, DNA / isotope markers) bound cryptographically to the proof | Closes the photo-to-shipment binding gap: the C2PA photo includes the per-item ID, the Oracle verifies *both* the photo signature *and* the ID's attestation, payment releases only when both match |

The multiplicative claim, summarised:

> Anchr alone proves *"some actor produced this data"*. Combined with
> hardware-rooted attestation, the chain proves *"this physical event
> happened in this physical world"*, with **payment cryptographically
> gated on the proof** and **independent audit by anyone who knows the
> product ID**. No single primitive does this; the composition does.

## What Anchr can solve in supply chains

Within the verification + settlement layer, Anchr provides:

- **Per-hop attestation verification** — C2PA chain validation, GPS
  Haversine proximity, TLSNotary cert-chain + body matching, freshness
- **Conditional hop payment** — Cashu HTLC release on verification pass,
  refund on locktime expiry
- **Decentralised audit trail** — Nostr events form an append-only,
  censorship-resistant log queryable by product ID
- **t-of-n Oracle attestation** — FROST threshold signing for high-value
  hops where a single Oracle is too much trust
- **Recursive chain composition** — same primitive reused at every
  layer, no special framework per industry

## What Anchr does NOT solve, even with adjacent crypto wired in

These remain out of reach regardless of how much attestation tech is
composed in. They are not Anchr's failures — they are properties of the
problem that need adjacent infrastructure:

| Gap | Why it remains |
|---|---|
| **Physical-to-digital binding when no per-item ID exists** | A C2PA photo proves "a camera was at this GPS" — not "*this specific* shipment was here". Without a per-item cryptographic identifier (NFC chip with attested key, sealed RFID, isotope/DNA marker), an attacker can photograph the *wrong* (cheaper) bag at the *right* place and pass verification. Issuing and binding identifiers is hardware infrastructure outside Anchr. |
| **Sensor placement** | A hardware-signed temperature sensor proves the *sensor* was at 4 °C — not that the *cargo* was. A malicious actor can keep the sensor in a fridge while the cargo cooks. Sealed-compartment hardware solves this; Anchr cannot. |
| **Workflow primitives beyond bilateral matching** | Anchr's bilateral cross-lock handles 1:1 hops. Real chains have one-to-many splits (1 container → N retailers), many-to-one merges (5 farms → 1 batch), returns, partial fulfillment, dispute arbitration. These need different primitives. |
| **Compliance bridges** | FSMA 204, EUDR, GS1 EPCIS, GS1 Digital Link, ISO 22005, industry-specific standards. Anchr produces cryptographic events; translation to compliance-shaped reports is a separate layer. |
| **API access negotiation** | TLSNotary on Maersk's API requires Maersk credentials. Anchr can verify the proof; getting access is the actor's problem. |
| **Settlement currency mismatch** | Supply-chain finance runs on USD/EUR via banks. Anchr settles in sats. Conversion to fiat for the actual paying parties is off-protocol. |
| **Adoption / network effect** | Even a perfect technical stack needs every party in the chain to participate. Network effect is the binding constraint for most real deployments — not technology. |

## Use case sketches

> Brief illustrative sketches. Each assumes the gaps above are filled
> by adjacent infrastructure.

### Coffee: Farm to Cup

```
Farm (Sao Paulo) → Port (Santos) → Ship → Port (Yokohama) → Roaster (Kawasaki) → Cafe (Shibuya)
```

- **Farmer** photographs the harvest with a C2PA camera; GPS in the
  signed EXIF binds the bag to the claimed farm
- **Exporter** TLSNotary-proves the carrier's tracking API showed the
  container loaded at Santos
- **Roaster** photographs arrival at Kawasaki (GPS + C2PA) and
  TLSNotary-proves the import customs API logged matching origin / HS
  code
- **Cafe** confirms final delivery with a GPS-verified photo in Shibuya

Each hop releases a Cashu HTLC payment to the previous actor.

### Pharmaceuticals: Cold-Chain Manufacturing to Pharmacy

```
Factory (Basel) → Cold Storage (Frankfurt) → Air Freight → Distribution (Tokyo) → Pharmacy (Osaka)
```

- **C2PA** photos prove physical handling at each facility
- **TLSNotary** on the temperature sensor's attested API proves the
  cold chain stayed within 2–8 °C throughout
- If the cold chain broke, the proof fails and payment never releases

### Luxury Goods: Workshop to Retail

```
Workshop (Florence) → Authentication Center (Milan) → Shipping → Retail (Ginza, Tokyo)
```

- **C2PA** photos with serial-number close-ups prove physical
  inspection at the authentication centre
- **TLSNotary** on the brand's authentication API confirms the serial
  number is genuine and not previously flagged
- **GPS** in C2PA EXIF prevents "ghost routing" through cheaper
  jurisdictions

## How this maps to Anchr's core

| Example concept | Anchr Core | Purpose |
|---|---|---|
| Per-hop GPS check | `GpsCoord` + `haversineKm()` in `src/domain/` | Proximity verification |
| Per-hop C2PA check | `packages/photo-bounty/` | Content Credential chain validation |
| Per-hop API attestation | `packages/tlsn-toolkit/` | TLSNotary proof verification |
| Per-hop conditional payment | `packages/cashu-conditional-swap/` | Cross-lock HTLC release |
| Chain audit log | Nostr relay integration | Decentralised event trail |
| Threshold Oracle | `packages/cashu-frost-oracle/` | FROST t-of-n signing |

## Implementation status

The `src/` directory:

- `supply-chain-types.ts` — type definitions for steps, proofs,
  products, requirements, verification reports
- `chain-verifier.ts` — verification engine: per-proof checks, chain
  integrity, time ordering, trust-score calculation
- `demo-coffee.ts` — runnable demo with **simulated** proofs

The demo exercises the verification engine against pre-populated proof
objects (no real capture, no real mint, no real relay). Run it with:

```bash
deno run --allow-all example/supply-chain-proof/src/demo-coffee.ts
```

The output is a verification report showing each hop's checks and the
trust score. It is enough to inspect the composition; not enough to
evaluate operational behaviour or real-world performance.

A wired-up implementation (real C2PA capture, real TLSNotary fetches,
real Cashu mint integration, real Nostr publish) is deferred until the
conceptual structure above is settled.

## Architecture (conceptual)

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
|              Anchr Oracle Verification (per hop)                          |
|   - C2PA signature chain valid?                                           |
|   - GPS within expected range?                                            |
|   - TLSNotary attestation valid? (domain, body, freshness)                |
|   - Sensor reading within bounds?                                         |
+--------------------------------------------------------------------------+
     |                       |                        |                       |
     v                       v                        v                       v
+--------------------------------------------------------------------------+
|                     Cashu HTLC Settlement                                 |
|   Hop verified → preimage released → previous actor redeems sats          |
+--------------------------------------------------------------------------+
```

<details>
<summary>HTTP API design (sketch — not implemented yet)</summary>

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
        { "proof_type": "c2pa_media", "conditions": [] }
      ],
      "payment_condition": { "amount_sats": 5000, "release_on_verification": true }
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
  "actor": { "name": "Fazenda Boa Vista", "pubkey": "a1b2c3..." },
  "location": { "lat": -23.5505, "lon": -46.6333, "name": "Coffee Farm, Sao Paulo" },
  "proofs": [
    { "type": "gps_photo", "data": { "lat": -23.5510, "lon": -46.6340, "photo_hash": "sha256:..." } },
    { "type": "c2pa_media", "data": { "signer": "ProofMode Camera", "signature_time": 1743724800 } }
  ],
  "previous_step_id": null
}
```

### Verify a product's full chain

```
GET /supply-chain/products/{product_id}/verify
```

Returns per-step verdicts, chain integrity, time ordering, and total sats released.

### Get a product's Nostr event trail

```
GET /supply-chain/products/{product_id}/events
```

Returns Nostr event IDs for independent verification by any relay client.

</details>

## See also

- [`example/royalty-distribution/`](../royalty-distribution/) — sister verification-only chain example. Same pattern (recursive R/W/O along chain/graph edges, no Cashu settlement) but in the *fully digital* domain, where the physical-binding gap doesn't exist. Useful as the contrast — royalty fits the pattern more cleanly; supply-chain shows where the pattern hits its physical limit.
- [`docs/architecture.md`](../../docs/architecture.md) — composition patterns (Bounty, Market, Verification-only chain).
- [`packages/cashu-conditional-swap/README.md`](../../packages/cashu-conditional-swap/README.md) — bilateral cross-lock primitive (not used here).
- [`packages/photo-bounty/`](../../packages/photo-bounty/) — C2PA + GPS verification primitives.
- [`packages/tlsn-toolkit/`](../../packages/tlsn-toolkit/) — TLSNotary verification primitives.

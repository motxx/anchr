# Royalty Distribution

> **Uses:** `@anchr/tlsn-toolkit` + Nostr event conventions (designed; current code is a simulation).
> **Does not use:** `@anchr/cashu-conditional-swap` — final payouts are typically off-protocol via existing settlement rails. Per-edge atomic settlement in sats is an opt-in extension.
> **Pattern:** verification-only evidence chain ([third composition pattern](../../docs/architecture.md#composition-patterns)).

> Conceptual foundation: how Anchr's primitives compose recursively
> across the *edges of a content rights graph* so that every payment is
> gated on a verifiable proof, every distribution is auditable by
> anyone, and under-/over-payment becomes mathematically detectable.

> **Status — implementation deferred.** `src/` contains type stubs
> and a tiny simulated demo. The conceptual structure described below
> is what the wired-up version aims to demonstrate; runnable
> end-to-end code will follow once the conceptual framing stabilises.

## The shape this addresses

Royalty distribution is a **graph problem**, not a linear chain:

- One piece of content has multiple right holders (composer, lyricist,
  performer, producer, publisher — different shares to each)
- Each holder may further redistribute (a publisher splits to writers;
  a label splits to artists)
- Content can derive from other content (samples, covers, remixes,
  translations) — the rights graph **extends recursively** into the
  ancestry
- Each use of content (stream, download, performance, sync, secondary
  sale, derivative work) triggers payments along the relevant edges of
  that graph

Today this graph is administered by intermediaries (collecting
societies, distributors, labels, marketplaces) who calculate splits
inside opaque systems. Right holders trust the intermediary's report.
Disputes are slow, expensive, and almost always end in settlement
without verification.

The same shape recurs in:

- **Music streaming** — platform → composer/lyricist/performer/producer
  → individuals
- **Sample / derivative chains** — a new song that samples an old song
  triggers payments to both the new song's holders and the sampled
  song's holders, recursively
- **NFT secondary royalties** — marketplace → seller, with royalty
  flowing back to the original creator (and its own derivatives)
- **Stock-media / sync licensing** — film uses a track, distributors
  pay platform, platform splits to track holders
- **Open source / academic citation funding** — donations or
  attribution-bound payments distributed to upstream contributors
- **AI training-data attribution** (emerging) — model output payments
  flowing back to training-set contributors

All of these are **graphs of attestations** where each edge is a
"someone owes someone else a share of something they did". Anchr's job
is to make every edge a verifiable, conditionally-settled link.

## What Anchr brings

### 1. Recursive Requester / Worker / Oracle at every edge

Each edge of the distribution graph reuses the same triple:

- **Requester** is the *paying* side of the edge — they want proof
  that the receiving side is genuinely entitled to this payment
- **Worker** is the *receiving* side — they (or their agent) produce
  the proof of entitlement (use occurred + share is correct)
- **Oracle** verifies the proof and gates the payment release

For a streaming use of a song with composer / performer / producer
splits, that's three concurrent edges from the platform, each running
the same triple in parallel. For a sample chain (Song B samples Song
A), Song B's edges have a *child set* of edges flowing from Song B's
holders down to Song A's holders — a recursive depth-2 (or deeper)
graph.

### 2. Per-edge proof composition

Each edge's "proof of entitlement" is itself composable:

- **Use proof** — TLSNotary on the platform's reporting API
  ("song X streamed N times in period Z")
- **Identity proof** — TLSNotary on a music-recognition API
  ("the streamed audio was actually song X")
- **Rights proof** — TLSNotary on the rights-database API
  ("song X's composer share is P% to pubkey Q")
- **Derivative proof** — Nostr event reference to the parent
  content's rights chain ("Song B is a sample of Song A; Song A's
  rights chain is at event E")

Composed, the edge proves *use → identification → entitlement → payment
amount*, all cryptographically verifiable from external sources.

### 3. Nostr event log = public audit trail of the whole graph

Each verified edge publishes a Nostr event. Walking the events for a
content ID reconstructs the full distribution graph for that content.
Anyone can:

- Verify every payment was based on a valid proof
- Detect underpayment (a use happened but no payment edge appears)
- Detect overpayment (more sats released than verified uses justify)
- Trace a derivative back through the sample / cover / translation
  chain
- Cross-check that two platforms' independent reports agree on the
  same underlying use counts

## Multiplicative effect with adjacent attestation tech

Anchr's primitives compose with the digital infrastructure that
already exists:

| Combined with | What the chain can prove that no single piece can |
|---|---|
| **Music / image / video recognition APIs** (ACRCloud, fingerprinting services) | "The use was actually *this* work" — closes the identification gap |
| **Authoritative rights databases** (publisher catalogs, registry APIs) | "This work has these holders with these shares at this point in time" — closes the entitlement gap |
| **Platform reporting APIs** (streaming counts, sales, performance logs) | "This use happened with this volume" — closes the volume gap |
| **C2PA / signed-capture provenance** | For media that needs origin verification (news photo licensing, original-creator NFTs) |
| **Content-addressed storage** (IPFS, Blossom) | The content itself is hash-addressed, so "this content" is precisely the bytes whose hash matches |

Composed: the chain proves *real use of real content with real rights
at real volume*, with payment cryptographically gated on the
composition. No single primitive does this; the recursive composition
across graph edges does.

## Why royalty fits Anchr cleanly

Compared to physical supply-chain, royalty has structural advantages
for Anchr's primitives:

| | Physical supply-chain | Royalty distribution |
|---|---|---|
| Physical-to-digital binding | **Hard problem** — photo of *some* bag ≠ photo of *this* bag without per-item ID infrastructure | **Not a problem** — content is its own digital fingerprint; recognition APIs close the identification gap directly |
| API access | Carriers / customs require partnership | Many platforms / databases expose public APIs amenable to TLSNotary |
| Settlement currency | Always fiat (banks, L/C) | Increasingly Bitcoin-friendly (NFT markets, indie creators, Web3 music); fiat rails still dominate but BTC adoption is plausible at edges |
| Workflow primitives | Splits, merges, returns, disputes — all undefined in Anchr | Royalty is mostly atomic per-use; bilateral cross-lock fits the per-edge edge case where atomic settlement *is* desired |
| Audit trail value | Brand reputation / regulatory | **Direct financial value** — every audited edge prevents real under-/over-payment fraud |

The verification-only chain pattern fits both, but royalty hits the
target with less adjacent infrastructure required.

## What Anchr does NOT solve

| Gap | Why |
|---|---|
| **Authoritative content identification** | Anchr can verify the recognition API's response, not whether the recognition was *correct*. Audio / image fingerprinting is its own ML problem with its own false-positive / false-negative rates. |
| **Authority over the rights graph** | Anchr can verify what the rights database returned, not who has authority to define the splits in the first place. Contracts and law remain off-protocol. |
| **Disputes about authorship** | "This is actually my work" disputes need legal / arbitration mechanisms; Anchr can record both sides' proofs but not adjudicate. |
| **Currency conversion** | Final payouts often need fiat. sats → fiat is off-protocol. |
| **Settlement adoption** | If existing intermediaries don't integrate, Anchr's per-edge atomic settlement remains opt-in for new domains (Web3 music, NFT royalties, indie distribution) rather than a drop-in replacement for legacy royalty rails. |
| **Privacy of right holders** | Anchr's audit trail is public by default. Anonymous right holdership requires additional cryptographic layers (blinded payments, etc.) not built here. |

## Use case sketches

> Each sketch describes how the recursive R/W/O triple wires across
> graph edges. Settlement currency varies by sketch — Anchr's
> verification-only chain is the constant.

### Streaming royalty (single content)

Platform reports "song X streamed N times this period". Verification:
the platform's API is TLSNotary'd. The rights database returns "song X
splits to composer A (40%), lyricist B (10%), performer C (30%),
producer D (20%)". Each share triggers a separate edge with its own
verifiable payment.

### Sample / derivative chain

Song B samples Song A. When Song B is used, the verified edges flow:
Platform → Song B's holders → (Song A's holders via the sample chain).
The sample-chain reference is a Nostr event linking Song B's rights
graph to Song A's. Verification recurses.

### NFT secondary royalty with derivative tracking

Original creator mints NFT. Secondary sale on marketplace. Verified
edges: marketplace → seller (sale proceeds) + marketplace →
original creator (royalty %). If the NFT is itself a derivative
(remix, fan art), the chain extends one more level.

### Sync licensing

Film uses a track. The film's distributor's reporting API is
TLSNotary'd. Sync rights flow to the track's holders, with the
track's recursive sample chain triggering deeper edges.

## Implementation status

`src/`:

- `royalty-types.ts` — type stubs for content, right holders, use
  events, distribution edges
- `demo-stream.ts` — tiny simulated demo: one song, three holders,
  one stream report, three verified edges, prints a distribution table

The demo currently injects mock proofs (no real TLSNotary fetch, no
real Cashu mint, no real Nostr publish). It's enough to inspect the
data shapes and the recursive verification pattern; not enough to
evaluate operational behaviour.

A wired-up implementation (real recognition API, real rights database
API, real platform API, optional Cashu HTLC settlement at edges where
parties want atomic per-use payment) is deferred until the conceptual
structure stabilises.

Run:

```bash
deno run --allow-all example/royalty-distribution/src/demo-stream.ts
```

## Architecture (conceptual)

```
                          Content (song / image / video / dataset)
                                       │
                       ┌───────────────┼───────────────┐
                       │               │               │
                  Right holder A   Right holder B   Right holder C
                  (composer 40%)   (performer 30%)  (producer 30%)
                       │               │               │
                  edge: pay A      edge: pay B      edge: pay C
                  proof: use+      proof: use+      proof: use+
                         share 40%        share 30%        share 30%
                       │               │               │
                       └───────┬───────┴───────┬───────┘
                               │               │
                  (each edge: independent      Oracle verifies each,
                   Requester/Worker/Oracle     publishes Nostr event,
                   triple at the same hop      releases settlement)
                   in the platform→holder
                   layer of the graph)
                               │
                  ─────────────┴─────────────
                   Audit log (Nostr): walk the events for the
                   content ID to reconstruct the full graph
```

For sample / derivative chains, each holder's content can itself
reference an upstream content's rights graph, recursing one level
deeper per sample.

## See also

- [`example/supply-chain-proof/`](../supply-chain-proof/) — sister verification-only chain example. Same pattern (recursive R/W/O along chain edges, no Cashu settlement) but in the *physical* domain, where the photo-to-shipment binding gap is the hard problem. Royalty has no analogous binding gap.
- [`docs/architecture.md`](../../docs/architecture.md) — composition patterns (Bounty, Market, Verification-only chain).
- [`packages/tlsn-toolkit/`](../../packages/tlsn-toolkit/) — TLSNotary verification primitives this example would consume.

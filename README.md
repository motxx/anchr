# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Specs: CC0](https://img.shields.io/badge/Specs-CC0-green.svg)](specs/LICENSE)

P2P-style verified-data purchase between pseudonymous parties, settled
atomically over Nostr.

> **Status: experimental.** Testnet only. SDK API design in progress;
> packages may change.

## Why this exists

TLSNotary attests that a server returned an HTTPS response at time T.
Cashu HTLC releases payment against a revealed secret. Combined over
Nostr DMs, two parties can exchange verified data and payment with no
Anchr-side intermediary — a thin oracle holds the HTLC preimage to
enforce atomic settlement, and the Cashu mint remains the trust anchor
for the ecash (as in any Cashu deployment).

This SDK orchestrates the exchange. It is **not a middleman**: you pick
every external service (Nostr relay, Cashu mint, TLSNotary notary,
oracle). Anchr runs no central server. Customers and providers are pseudonymous
Nostr pubkeys; no real-name accounts or KYC.

Each primitive (NIP-90, Cashu HTLC, TLSNotary) exists in isolation. The
hard part is composing them so payment release and proof verification
happen atomically — that's what this SDK does.

## How it works

1. **Customer** locks Cashu HTLC at the mint with hashlock `H` (from oracle).
2. **Customer** broadcasts a kind 5300 Job Request to Nostr relays — no
   specific provider addressed.
3. **Providers** subscribed to the request's `schema` reply with kind 7000
   quotes. **Customer** selects one and binds the HTLC to the chosen
   provider's pubkey.
4. **Provider** produces a proof matching the schema, encrypts the response
   to the customer's pubkey via NIP-44, and publishes a kind 6300 event.
5. **Oracle** verifies the proof against the schema; if valid, sends
   preimage `S` to the provider via NIP-44 DM.
6. **Provider** redeems the HTLC at the mint with `S` — paid.

The oracle alone gates payment release based on proof validity. The customer
cannot withhold payment after a valid proof; the provider cannot get paid
without producing one. If no provider delivers a valid proof before the HTLC's locktime expires,
the customer's payment refunds automatically.

Wire-compatible with [NIP-90 DVM](https://github.com/nostr-protocol/nips/blob/master/90.md)
event kinds (5300 / 6300 / 7000) so DVM-aware clients can interoperate.

## Install

```sh
deno add @anchr/sdk
# or
npm i @anchr/sdk
```

## Quick start

**Customer:**

```ts
import { createCustomer } from "@anchr/sdk";

const customer = createCustomer({
  oracles: ["npub1oracle1...", "npub1oracle2..."],  // accepted oracle whitelist
  relays:  ["wss://relay.example.org"],
  mint:    "https://mint.example.org",
});

const result = await customer.request({
  spec: {
    schema: "io.anchr.tlsn-https.v1",
    predicate: {
      target: "https://api.github.com/users/alice",
      conditions: [{ path: "$.public_repos", op: ">", value: 10 }],
    },
    description: "GitHub user has more than 10 public repos",  // optional
  },
  payment: { maxAmount: 1000 },  // accept any quote up to this
});

console.log(result.data);          // verified response payload
console.log(result.proof);         // proof bytes (format depends on schema)
console.log(result.providerPubkey);  // who fulfilled the request
```

The customer broadcasts the request — any provider that supports the schema
can quote. The SDK picks the cheapest quote within `maxAmount`. To
target a specific provider, pass `provider: "npub1..."` instead.

**Provider:**

```ts
import { createProvider } from "@anchr/sdk";

const provider = createProvider({
  oracles: ["npub1oracle1...", "npub1oracle2..."],  // accepted oracle whitelist
  notary:  "wss://notary.example.org",
  relays:  ["wss://relay.example.org"],
  mint:    "https://mint.example.org",
  privKey: "nsec1...",
});

await provider.serve(async (request) => {
  // request.spec.schema tells you what proof format to produce.
  // Schema-specific producers live in @anchr/tlsn-toolkit, @anchr/photo-bounty, etc.
  return await produceProof(request.spec);
});
```

> **Note.** The API above is the design target. Current
> [`@anchr/sdk`](packages/sdk/) does not yet match this shape — see
> the package README for current state.

## Components (you choose)

The SDK does not bundle these — you pass URLs/pubkeys at construction
time. Run your own, or use third-party infrastructure.

| Component | Role | Required for | Examples |
|---|---|---|---|
| **Oracle** | Atomic exchange enforcer. Verifies proof, releases HTLC preimage. Customer and provider each pass a whitelist; the protocol uses one oracle from the intersection. | All schemas | Self-host single-party, or FROST t-of-n cluster |
| **Relay** | Nostr message transport. Any vanilla relay. | All schemas | strfry, nostr-rs-relay, third-party relays |
| **Mint** | Cashu HTLC ecash issuer. Any vanilla mint. | All schemas | nutshell, cashu-rs-mint, public test mints |
| **Notary** | TLSNotary verifier. Mediates the provider's TLS proof session. | TLSN-based schemas only | Self-host (`crates/tlsn-*`), or any compatible notary |

## Verification types

The SDK does not bake in any verification format. Each request carries
a `schema` URI; provider and oracle interpret it. New formats plug in by
publishing a schema, not by upgrading the SDK.

| Schema | Use case |
|---|---|
| `io.anchr.tlsn-https.v1` | TLSNotary attestation of an HTTPS response |
| `io.anchr.c2pa-image.v1` | C2PA-signed photo / video with optional GPS predicate |

Schemas live as Nostr parameterized replaceable events (kind `30888`);
each defines the `predicate` shape, the proof format, and verification
rules.

## Examples

Use this SDK to build the products below. Status shows current
implementation — see each example's README for what runs today.

| Product | Status |
|---|---|
| Airdrop sybil resistance ([Katashiro](example/airdrop-bot-shield/)) | Simulation |
| Verifiable photo marketplace ([C2PA](example/c2pa-media-verification/)) | Testnet |
| 2-party binary bet ([Kannagi](example/prediction-market/)) | Testnet |
| Browser auto-claim ([Auto-claim](example/auto-claim/)) | Concept |
| Fiat → BTC swap ([Watari](example/tlsn-fiat-swap-square/)) | Concept (TLSN-on-Square compatibility risk) |

Composition sketches (not products):
[Royalty distribution](example/royalty-distribution/),
[Supply-chain proof](example/supply-chain-proof/).

## Underlying packages

Each is independently usable.

| Package | Purpose |
|---|---|
| [`@anchr/sdk`](packages/sdk/) | Customer/provider orchestration over the components above |
| [`@anchr/tlsn-toolkit`](packages/tlsn-toolkit/) | TLSNotary proof verification (replay-protected, ReDoS-safe) |
| [`@anchr/cashu-conditional-swap`](packages/cashu-conditional-swap/) | Cross-lock primitive (HTLC + FROST P2PK) |
| [`@anchr/cashu-frost-oracle`](packages/cashu-frost-oracle/) | FROST t-of-n threshold signing wrapper |
| [`@anchr/core-cashu`](packages/core-cashu/) | Cashu HTLC escrow primitives |
| [`@anchr/photo-bounty`](packages/photo-bounty/) | C2PA + GPS + ProofMode + EXIF + AI heuristic verification |

Plus Rust crates: `crates/frost-signer` (FROST signing daemon),
`crates/tlsn-*` (TLSNotary integrations).

## Reference

- [Architecture](docs/architecture.md) — layer dependencies and
  composition patterns
- [Threat model](docs/threat-model.md) — attacker assumptions and
  mitigations
- [Wire spec](specs/) — protocol on the wire (CC0, anyone may implement)
- [Contributing](CONTRIBUTING.md) — local stack, test commands

## License

Code: [MIT](LICENSE) · Specs: [CC0](specs/LICENSE) — anyone may implement.

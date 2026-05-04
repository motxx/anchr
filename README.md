# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Specs: CC0](https://img.shields.io/badge/Specs-CC0-green.svg)](specs/LICENSE)

Anchr is an SDK for hiring an authenticated proxy: pay a stranger to
retrieve private data or perform an action you can't, with payment held
until they prove they did it — atomic over Nostr, no Anchr server.

> **Status: experimental.** Testnet only. SDK API design in progress;
> packages may change.

## What you can build

A Customer pays a Provider for something the Customer can't obtain
alone, with payment held in escrow until the proof verifies.

- **Authenticated API proxy** — Pay an account holder to query a private
  API on their own data (bank balance, exchange order history, paid
  subscription content) and return the response with a TLSNotary
  attestation — a cryptographic proof that the HTTPS server actually
  returned that response, signed by a third-party notary that didn't
  see the plaintext.
- **Self-attested presence** — Pay someone to prove a fact only they can
  show: GitHub contribution count, Reddit karma, account age. For
  airdrop sybil-resistance or gated access without doxxing.

## What problem it solves

**Atomic exchange.** Pay-first risks getting nothing; deliver-first
risks not getting paid. Anchr removes the deadlock: payment releases iff
a valid proof exists, and refunds automatically if no proof arrives
before the locktime of the Cashu HTLC (a hash-time-locked escrow:
spendable with the unlock secret, or refunded after the timeout).
Neither side can cheat — the Customer can't withhold after a valid
proof, and the Provider can't get paid without one.

**No middleman.** Anchr runs no server. Customer and Provider are
pseudonymous Nostr pubkeys, and they pick every external service
themselves: Nostr relay, Cashu mint, oracle, TLSNotary notary. Anchr the
project cannot censor, surveil, or be subpoenaed about a transaction it
never sees.

## How it works

The exchange has three active roles. Anchr is none of them — the SDK
only wires them together.

- **Customer** — locks payment up front, receives verified data.
- **Provider** — produces the proof, redeems the payment against it.
- **Oracle** — verifies the proof and reveals the payment-unlock
  secret. Customer and Provider each whitelist oracles they trust,
  and the SDK picks one from the intersection. Run solo, or split
  trust across a FROST (threshold-signing) t-of-n cluster.

**The Oracle never holds funds — only the secret that unlocks them.**
A misbehaving Oracle can't steal payments; the worst case is collusion
with a Provider to leak the secret without a real proof verification.
For collusion bounds and threat assumptions, see
[docs/threat-model.md](docs/threat-model.md).

Plus two or three pieces of vanilla infrastructure: a **Cashu mint**
holds the payment in an HTLC, a **Nostr relay** carries every message,
and (for TLSN-based schemas only) a **TLSNotary notary** mediates the
Provider's TLS proof session.

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant M as Cashu Mint
    participant R as Nostr Relay
    actor P as Provider
    actor O as Oracle

    C->>M: lock payment (HTLC)
    C->>R: post request
    R->>P: discover; reply with quote
    C->>M: bind HTLC to Provider
    P->>P: produce proof
    P->>R: post proof
    R-->>O: deliver proof
    O->>O: verify
    O->>P: on pass, send unlock secret
    P->>M: redeem
```

If no valid proof arrives before the HTLC's locktime, the Customer's
funds refund automatically.

Wire-compatible with
[NIP-90 DVM](https://github.com/nostr-protocol/nips/blob/master/90.md)
(Nostr's request/response market protocol) event kinds — 5300 =
request, 6300 = result, 7000 = status — so DVM-aware clients can
interoperate.

For event kinds, locktime semantics, oracle threshold signing, and the
encrypted DM flow, see [docs/architecture.md](docs/architecture.md).

## Install

```sh
deno add @anchr/sdk
# or
npm i @anchr/sdk
```

You'll also need: a Cashu mint URL, a Nostr relay URL, an oracle (HTTP
endpoint + pubkey) to whitelist, and a Nostr secret key (Providers
only). See [`example/`](example/) for a runnable test setup with all
of these wired up.

## Components (you choose)

The SDK does not bundle these — you pass URLs/pubkeys at construction
time. Run your own, or use third-party infrastructure.

| Component | Role | Required for | Self-host or use |
|---|---|---|---|
| **Oracle** | Verifies proof, releases the unlock secret | All | `crates/frost-signer` (solo or FROST t-of-n) |
| **Relay** | Nostr transport | All | strfry, nostr-rs-relay, public relays |
| **Mint** | Cashu HTLC escrow | All | nutshell, cashu-rs-mint, public test mints |
| **Notary** | TLS proof session mediator | TLSN only | `crates/tlsn-*`, or any compatible notary |

## Quick start

The snippets below show API shape only. For runnable Customer/Provider
code (with adapter setup), see
[`example/two-party-binary-bet/`](example/two-party-binary-bet/).

```ts
// Customer side — the SDK generates an ephemeral Nostr key per request,
// so no privKey is needed here.
import { createCustomer, createHttpOracleClient } from "@anchr/sdk";

const customer = createCustomer({
  oracles: ["npub1oracle1...", "npub1oracle2..."],  // whitelist
  relays:  ["wss://relay.example.org"],
  mint:    "https://mint.example.org",  // SDK builds a Cashu client from this
  oracleClient: createHttpOracleClient({
    endpoint:     "https://oracle.example.org",
    oraclePubkey: "npub1oracle1...",
  }),
});

const { data, proof, providerPubkey } = await customer.request({
  spec: {
    schema: "io.anchr.tlsn-https.v1",
    predicate: {
      target: "https://api.github.com/users/alice",
      conditions: [{ path: "$.public_repos", op: ">", value: 10 }],
    },
  },
  payment: { maxAmount: 1000 },  // sats; cheapest quote up to this is picked
});
```

The Customer broadcasts to any Provider subscribed to the schema. The
SDK auto-selects the cheapest valid quote; pass `provider: "npub1..."`
to target a specific Provider directly.

Config asymmetries:

| Field          | Customer | Provider | Why |
|---|---|---|---|
| `oracleClient` | required | — | Provider's only Oracle interaction is receiving the unlock secret via Nostr DM |
| `privKey`      | — (ephemeral) | required | Provider needs a stable identity for HTLC redemption; Customer signs each request with a fresh key |
| `notary`       | — | TLSN schemas only | Proof embeds the notary's pubkey, so the Customer can verify without an external notary URL |
| `cashuClient`  | optional | optional | SDK auto-builds from `mint` |

The Customer's `oracleClient.oraclePubkey` must match one of the entries
in `oracles` (the whitelist). The intersection between Customer and
Provider whitelists is computed at request time; the SDK picks one
oracle from it and routes through the Customer's `oracleClient`.

```ts
// Provider side
import { createProvider } from "@anchr/sdk";

const provider = createProvider({
  oracles: ["npub1oracle1...", "npub1oracle2..."],
  notary:  "wss://notary.example.org",  // TLSN-based schemas only
  relays:  ["wss://relay.example.org"],
  mint:    "https://mint.example.org",
  privKey: "nsec1...",
});

await provider.serve(async (request) => {
  return {
    amountSats: 100,  // asking price for this request
    produce: async () => {
      // Match request.spec.schema to a proof producer
      // (e.g. @anchr/tlsn-toolkit for io.anchr.tlsn-https.*).
      return await produceProof(request.spec);  // returns { data, proof }
    },
  };
});
```

## Verification schemas

The SDK does not bake in any verification format. Each request carries
a `schema` URI; Provider and Oracle interpret it. New formats plug in
by publishing a schema, not by upgrading the SDK.

| Schema | Use case |
|---|---|
| `io.anchr.tlsn-https.v1` | TLSNotary attestation of an HTTPS response |
| `io.anchr.c2pa-image.v1` | C2PA (Coalition for Content Provenance and Authenticity)-signed photo / video, with cryptographic provenance back to the capture device. Optional GPS predicate. |

Schemas are themselves Nostr events (versioned and discoverable by URI),
defining the predicate shape, proof format, and verification rules.

## Examples

Use this SDK to build the products below. Status shows current
implementation — see each example's README for what runs today.

| Product | Status |
|---|---|
| Verifiable photo marketplace ([C2PA](example/c2pa-media-verification/)) | Testnet |
| Two-party binary bet ([Kannagi](example/two-party-binary-bet/)) | Testnet |
| Airdrop sybil resistance ([Katashiro](example/airdrop-bot-shield/)) | Simulation |
| Browser auto-claim ([Auto-claim](example/auto-claim/)) | Concept |
| Fiat → BTC swap ([Watari](example/tlsn-fiat-swap-square/)) | Concept (TLSN-on-Square compatibility risk) |

Composition sketches (not products):
[Royalty distribution](example/royalty-distribution/),
[Supply-chain proof](example/supply-chain-proof/).

## Underlying packages

**User-facing** — what you import directly:

| Package | Purpose |
|---|---|
| [`@anchr/sdk`](packages/sdk/) | Customer/Provider orchestration (main entry) |
| [`@anchr/tlsn-toolkit`](packages/tlsn-toolkit/) | TLSNotary proof producer/verifier (for TLSN-based Providers) |
| [`@anchr/photo-bounty`](packages/photo-bounty/) | C2PA + GPS + ProofMode + EXIF + AI heuristic verification (for C2PA-based Providers) |

**Internal** — `@anchr/sdk` depends on these; usually you don't import directly:

| Package | Purpose |
|---|---|
| [`@anchr/cashu-conditional-swap`](packages/cashu-conditional-swap/) | Cross-lock primitive (HTLC + FROST P2PK) |
| [`@anchr/cashu-frost-oracle`](packages/cashu-frost-oracle/) | FROST t-of-n threshold signing wrapper |
| [`@anchr/core-cashu`](packages/core-cashu/) | Cashu HTLC escrow primitives |

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

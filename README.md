# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Specs: CC0](https://img.shields.io/badge/Specs-CC0-green.svg)](specs/LICENSE)

Anchr is a protocol and SDK set for peer-to-peer verified work. A Customer can
pay an unknown Provider to fetch data, produce evidence, or take an action, and
the Provider can redeem payment only after a trusted Oracle accepts the proof.

This repository makes that flow usable for implementers. Its primary
deliverables are the wire-format specs, actor SDKs for Customer/Provider/Oracle
roles, reference adapters for Nostr/Cashu/proof tooling, and runnable examples
that show how those pieces compose. It is not an Anchr-operated marketplace,
hosted server, wallet, oracle network, or production deployment.

It combines:

- **Nostr** for peer discovery and request/response transport
- **Cashu HTLCs** for escrow and automatic refunds
- **Oracle verification** for TLSNotary, C2PA/photo, or application-specific
  proofs

> **Status:** experimental, testnet-focused, and not production-hardened. The
> core Cashu HTLC and Nostr paths have automated coverage; TLSNotary, C2PA,
> FROST, and conditional-swap integrations are exercised by reference flows with
> narrower assumptions. See the [threat model](docs/threat-model.md).

## What It Solves

Anchr removes the pay-first / deliver-first deadlock for verifiable off-chain
work.

The Customer locks payment before work begins. The Provider can redeem only if a
trusted oracle accepts the proof. If no valid proof arrives before the timeout,
the Customer gets an automatic refund from the Cashu mint.

Anchr does not run a central server. Customers and Providers are pseudonymous
Nostr pubkeys, and each app chooses its own relay, mint, oracle, and notary.

## Repository Map

Start with `@anchr/sdk` when you want to build an app. Use the lower-level
packages when you are implementing a custom actor, adapter, proof engine, or
settlement primitive.

| Area | Paths | Role |
| --- | --- | --- |
| Protocol contract | [`specs/`](specs/), [`packages/protocol/`](packages/protocol/) | Wire shapes, schema identifiers, event builders, signing helpers, and role-neutral types. |
| Actor SDKs | [`packages/sdk/`](packages/sdk/), [`packages/customer-sdk/`](packages/customer-sdk/), [`packages/provider-sdk/`](packages/provider-sdk/), [`packages/oracle-sdk/`](packages/oracle-sdk/) | Public integration APIs for app developers. Runtime pieces are injected through explicit ports. |
| Supporting primitives | [`packages/core-cashu/`](packages/core-cashu/), [`packages/cashu-conditional-swap/`](packages/cashu-conditional-swap/), [`packages/frost-oracle/`](packages/frost-oracle/), [`packages/blossom/`](packages/blossom/) | Reusable settlement, threshold-signing, and attachment-storage building blocks. |
| Proof toolkits | [`packages/tlsn-toolkit/`](packages/tlsn-toolkit/), [`packages/photo-verification/`](packages/photo-verification/) | Verification engines for TLSNotary, C2PA, EXIF, ProofMode, and related evidence. |
| Runtime support | [`packages/core-runtime/`](packages/core-runtime/) | Cross-runtime helpers for Deno/Bun/Node boundaries, process spawning, file I/O, env, and logging. |
| Transitional flow code | [`packages/bounty/`](packages/bounty/) | Migration scaffolding for the older bounty/query lifecycle while actor SDK and adapter boundaries are split. |
| Apps and examples | [`apps/`](apps/), [`examples/`](examples/) | Maintained runnable surfaces live in `apps/`; small demos, testnet flows, concept sketches, and fixtures live in `examples/`. Status is per entry. |
| Native helpers | [`crates/`](crates/) | Rust binaries used by FROST and TLSNotary tooling. |

The intended long-term shape is a small protocol/SDK core with concrete
adapters and examples kept replaceable. See
[`docs/architecture.md`](docs/architecture.md) for current and target package
boundaries.

## Example Uses

- Pay an account holder to query a private API and return the response with a
  TLSNotary attestation.
- Pay someone to prove an account fact such as contribution count, karma, or
  account age without exposing the whole account.
- Build a verified photo marketplace where C2PA provenance gates payment.

## How It Works

```mermaid
sequenceDiagram
    autonumber
    participant Customer
    participant Relay as Nostr Relay
    participant Provider
    participant Oracle
    participant Mint as Cashu Mint

    Customer->>Mint: Lock payment in a Cashu HTLC
    Customer->>Relay: Publish work request
    Relay-->>Provider: Deliver request
    Provider->>Relay: Publish offer
    Relay-->>Customer: Deliver offer
    Customer->>Relay: Accept offer and bind escrow
    Relay-->>Provider: Deliver selection
    Provider->>Provider: Produce data and proof
    Provider->>Oracle: Submit proof for verification

    alt Proof accepted before timeout
        Oracle-->>Provider: Release unlock secret
        Provider->>Mint: Redeem HTLC
    else No valid proof before timeout
        Customer->>Mint: Refund after timeout
    end
```

The oracle never holds funds. It only controls whether the unlock secret is
released, so oracle trust still matters. Use solo oracles for simple flows, or a
FROST threshold signer when the trust assumption should be split.

## Install

```sh
deno add @anchr/sdk
# or
npm i @anchr/sdk
```

You also need deployment-owned infrastructure: a Cashu mint URL, Nostr relay
URL, oracle endpoint/pubkey, and Provider Nostr secret key. TLSNotary-based
schemas also need a notary. The repository supplies reference clients and
examples, not default production infrastructure.

## Quick Start

The snippet shows the Customer-side API shape. For a complete running flow, see
[`examples/c2pa-media-verification/`](examples/c2pa-media-verification/).

```ts
import {
  createCashuClient,
  createCustomer,
  createHttpOracleClient,
  createRelayClient,
  type CashuProof,
} from "@anchr/sdk";

const mintUrl = "https://mint.test.example";
const relayUrls = ["wss://relay.test.example"];
const oraclePubkey = "npub1exampleoraclepubkey";
const cashuProofsFromYourWallet: CashuProof[] = [];

const customer = createCustomer({
  oracles: [{
    pubkey: oraclePubkey,
    client: createHttpOracleClient({
      endpoint: "https://oracle.test.example",
    }),
  }],
  relays: relayUrls,
  mint: mintUrl,
  cashuClient: createCashuClient({ mintUrl }),
  relayClient: createRelayClient(relayUrls),
});

const { data, proof, providerPubkey } = await customer.request({
  spec: {
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: {
      target: "https://api.github.com/users/alice",
      conditions: [{ path: "$.public_repos", op: ">", value: 10 }],
    },
  },
  payment: { maxAmount: 1000 },
  sourceProofs: cashuProofsFromYourWallet,
});
```

For multiple trusted oracles, keep the whitelist and its matching transport in
one `oracles` list:

```ts
import {
  createCashuClient,
  createCustomer,
  createHttpOracleClient,
  createRelayClient,
} from "@anchr/sdk";

const mintUrl = "https://mint.test.example";
const relayUrls = ["wss://relay.test.example"];
const oracleA = "npub1exampleoraclea";
const oracleB = "npub1exampleoracleb";

const multiOracleCustomer = createCustomer({
  oracles: [
    {
      pubkey: oracleA,
      client: createHttpOracleClient({
        endpoint: "https://oracle-a.test.example",
      }),
    },
    {
      pubkey: oracleB,
      client: createHttpOracleClient({
        endpoint: "https://oracle-b.test.example",
      }),
    },
  ],
  relays: relayUrls,
  mint: mintUrl,
  oracleSelector: (oracles: readonly string[]) => oracles[1] ?? oracles[0],
  cashuClient: createCashuClient({ mintUrl }),
  relayClient: createRelayClient(relayUrls),
});
```

Providers use `createProvider(...)` and attach a proof producer for the
requested schema. That Provider process can be long-running, because it must
receive Customer requests and produce proofs, but it is not an Anchr-operated
middleman. See the examples for Provider setup, adapter wiring, and local stack
commands.

## Verification Schemas

The SDK does not bake in a proof format. Each request carries a schema URL, and
the Provider and Oracle interpret it.

| Schema                   | Use case                                   |
| ------------------------ | ------------------------------------------ |
| `https://anchr-spec.org/spec/proof/tlsn/v1` | TLSNotary attestation of an HTTPS response |
| `https://anchr-spec.org/spec/proof/c2pa-image/v1` | C2PA-signed photo/video provenance and GPS |

## Reference Implementations

Status labels are defined in
[`docs/universality-boundaries.md`](docs/universality-boundaries.md#example-status-vocabulary).
The checklist for promoting or maintaining an advertised example lives in
[`docs/example-delivery-lifecycle.md`](docs/example-delivery-lifecycle.md).

| Example                                                    | What it shows                                  | Status      |
| ---------------------------------------------------------- | ---------------------------------------------- | ----------- |
| [C2PA photo marketplace](examples/c2pa-media-verification/) | Customer/Provider flow with photo verification | Testnet     |
| [TLSN fiat swap](examples/tlsn-fiat-swap-square/)           | Customer/Provider flow with TLSNotary          | Testnet     |
| [Browser auto-claim](examples/auto-claim/)                  | TLSNotary-based browser automation             | Concept     |
| [Two-party binary bet](apps/two-party-binary-bet/)          | Conditional swap primitive outside the SDK     | Implemented |
| [Airdrop bot shield](apps/airdrop-bot-shield/)              | Verification-only attestation flow             | Implemented |

## More Detail

- [Architecture](docs/architecture.md) - layer boundaries and design notes
- [Threat model](docs/threat-model.md) - trust assumptions and mitigations
- [Wire spec](specs/) - protocol shapes, event kinds, and payloads
- [Contributing](CONTRIBUTING.md) - local stack and test commands

## License

Code: [MIT](LICENSE). Specs: [CC0](specs/LICENSE), so anyone may implement them.

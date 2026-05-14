# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Specs: CC0](https://img.shields.io/badge/Specs-CC0-green.svg)](specs/LICENSE)

Anchr is an experimental SDK for P2P verified work: pay a stranger to fetch data
or take an action, with payment released only after a whitelisted oracle
verifies the proof.

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

Anchr removes the pay-first / deliver-first deadlock.

The Customer locks payment before work begins. The Provider can redeem only if a
trusted oracle accepts the proof. If no valid proof arrives before the timeout,
the Customer gets an automatic refund from the Cashu mint.

Anchr does not run a central server. Customers and Providers are pseudonymous
Nostr pubkeys, and each app chooses its own relay, mint, oracle, and notary.

## Example Uses

- Pay an account holder to query a private API and return the response with a
  TLSNotary attestation.
- Pay someone to prove an account fact such as contribution count, karma, or
  account age without exposing the whole account.
- Build a verified photo marketplace where C2PA provenance gates payment.

## How It Works

1. Customer creates a request and locks payment in a Cashu HTLC.
2. Providers see the request over Nostr and return offers.
3. Customer accepts an offer and binds the escrow to the Provider.
4. Provider produces data plus proof.
5. Oracle verifies the proof and releases the unlock secret.
6. Provider redeems; otherwise the Customer refunds after timeout.

The oracle never holds funds. It only controls whether the unlock secret is
released, so oracle trust still matters. Use solo oracles for simple flows, or a
FROST threshold signer when the trust assumption should be split.

## Install

```sh
deno add @anchr/sdk
# or
npm i @anchr/sdk
```

You also need a Cashu mint URL, Nostr relay URL, oracle endpoint/pubkey, and a
Provider Nostr secret key. TLSNotary-based schemas also need a notary.

## Quick Start

The snippet shows the Customer-side API shape. For a complete running flow, see
[`example/c2pa-media-verification/`](example/c2pa-media-verification/).

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
  oracles: [oraclePubkey],
  relays: relayUrls,
  mint: mintUrl,
  oracleClient: createHttpOracleClient({
    endpoint: "https://oracle.test.example",
    oraclePubkey,
  }),
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

| Example                                                    | What it shows                                  | Status      |
| ---------------------------------------------------------- | ---------------------------------------------- | ----------- |
| [C2PA photo marketplace](example/c2pa-media-verification/) | Customer/Provider flow with photo verification | Testnet     |
| [TLSN fiat swap](example/tlsn-fiat-swap-square/)           | Customer/Provider flow with TLSNotary          | Testnet     |
| [Browser auto-claim](example/auto-claim/)                  | TLSNotary-based browser automation             | Concept     |
| [Two-party binary bet](example/two-party-binary-bet/)      | Conditional swap primitive outside the SDK     | Implemented |
| [Airdrop bot shield](example/airdrop-bot-shield/)          | Verification-only attestation flow             | Simulation  |

## More Detail

- [Architecture](docs/architecture.md) - layer boundaries and design notes
- [Threat model](docs/threat-model.md) - trust assumptions and mitigations
- [Wire spec](specs/) - protocol shapes, event kinds, and payloads
- [Contributing](CONTRIBUTING.md) - local stack and test commands

## License

Code: [MIT](LICENSE). Specs: [CC0](specs/LICENSE), so anyone may implement them.

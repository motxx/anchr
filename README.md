# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Specs: CC0](https://img.shields.io/badge/Specs-CC0-green.svg)](specs/LICENSE)

Anchr is an SDK for verifiable paid requests. A Customer locks payment, a
Provider does the work, and the Provider can redeem only after a trusted Oracle
accepts the proof. It removes the pay-first / deliver-first deadlock for
verifiable off-chain work.

The public deliverables are `@anchr/sdk` for application developers and
`@anchr/protocol` for interoperable wire contracts. Anchr is not a hosted
service; each app chooses its own relay, mint, oracle, and notary.

It combines:

- **Nostr** for peer discovery and request/response transport
- **Cashu HTLCs** for escrow and automatic refunds
- **Oracle verification** for TLSNotary, C2PA/photo, or application-specific
  proofs

> **Status:** experimental and testnet-focused. See the
> [threat model](docs/threat-model.md) before treating any flow as production
> infrastructure.

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

The Oracle never holds funds. It only controls whether the unlock secret is
released, so oracle trust still matters. Use solo oracles for simple flows, or a
FROST threshold signer when the trust assumption should be split.

## Example Uses

- Pay an account holder to query a private API and return the response with a
  TLSNotary attestation.
- Pay someone to prove an account fact such as contribution count, karma, or
  account age without exposing the whole account.
- Build a verified photo workflow where C2PA provenance gates payment.

## Install

```sh
deno add @anchr/sdk
# or
npm i @anchr/sdk
```

You also need deployment-owned infrastructure: a Cashu mint URL, Nostr relay
URL, oracle endpoint/pubkey, and Provider Nostr secret key. TLSNotary-based
schemas also need a notary.

## Quick Start

From a clean checkout (with [Deno](https://deno.com/) installed), publish a
Public Request Advertisement to a relay you choose and read it back:

```sh
git clone https://github.com/motxx/anchr && cd anchr
NOSTR_RELAYS=wss://your-relay.example deno run --allow-net --allow-env examples/quick-start/main.ts
```

The command builds a kind `5300` advertisement with the SDK under a fresh
ephemeral keypair, publishes it to your relay, and prints the advertisement
the relay echoes back. No payment is locked: the advertisement carries only
public discovery fields, and the full payment-locked exchange is the
[`paid-request-simulation`](examples/paid-request-simulation/) lesson. A
deterministic smoke test covers the same code path in CI without contacting
any third-party relay (see
[`examples/quick-start/`](examples/quick-start/)).

## Customer API Sketch

```ts
import {
  createCashuClient,
  createCustomer,
  createHttpOracleClient,
  createRelayClient,
  ProofSchema,
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
    schema: ProofSchema.TlsnV1,
    predicate: {
      target: "https://api.github.com/users/alice",
      conditions: [{ path: "$.public_repos", op: ">", value: 10 }],
    },
  },
  payment: { maxAmount: 1000 },
  sourceProofs: cashuProofsFromYourWallet,
});
```

For the full Customer, Provider, Oracle, payment, proof, and testing APIs, see
[`packages/sdk/README.md`](packages/sdk/README.md). For wire contracts and
schema identifiers, use `@anchr/protocol` and [`specs/`](specs/).

## Repository Map

| Area | Paths | Role |
| --- | --- | --- |
| SDK | [`packages/sdk/`](packages/sdk/) | Customer, Provider, Oracle, payment, proof, attachment, adapter, and testing helpers. |
| Protocol | [`packages/protocol/`](packages/protocol/), [`specs/`](specs/) | Nostr wire events, Cashu settlement fields, schema identifiers, validators, and protocol types. |
| Native helpers | [`crates/`](crates/) | Rust binaries used by FROST and TLSNotary tooling. |

See [`docs/architecture.md`](docs/architecture.md) for package boundaries and
public-surface policy.

## Examples

Status labels are defined in
[`docs/universality-boundaries.md`](docs/universality-boundaries.md#example-status-vocabulary).

| Example | Status | Lesson |
| --- | --- | --- |
| [`quick-start`](examples/quick-start/) | Testnet | Publish a Public Request Advertisement to a real relay with SDK-built events and read it back. |
| [`paid-request-simulation`](examples/paid-request-simulation/) | Simulation | Compose Customer, Provider, Oracle, payment, proof, attachment, and adapter boundaries through public SDK imports. |

New examples must be tiny lessons for verifiable paid requests and must use
only `@anchr/sdk` or `@anchr/protocol` for Anchr imports.

## More Detail

- [Documentation index](docs/README.md) - public docs and maintainer workflow
- [Architecture](docs/architecture.md) - layer boundaries and design notes
- [Threat model](docs/threat-model.md) - trust assumptions and mitigations
- [Wire spec](specs/) - protocol shapes, event kinds, and payloads
- [Contributing](CONTRIBUTING.md) - local stack and test commands

## License

Code: [MIT](LICENSE). Specs: [CC0](specs/LICENSE), so anyone may implement them.

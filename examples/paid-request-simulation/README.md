# Paid Request Simulation

Status: Simulation

This example runs a deterministic Customer to Provider paid request using
`@anchr/sdk` only. It proves the SDK actor, transport, payment, proof, Oracle,
and attachment boundaries compose without importing repository internals.

## User Flow

A Customer asks for a TLSNotary-shaped result. An in-memory Provider accepts the
request, returns fixture data and proof bytes, receives an Oracle preimage
release, and redeems the simulated Cashu HTLC.

## Dependencies

Real dependencies:

- Deno
- `@anchr/sdk`

Simulated dependencies:

- In-memory Nostr-style relay
- Stub Cashu client
- Fixture Oracle preimage release
- Fixture proof bytes and attachment URL

## Non-Production Boundary

This is not a testnet or production flow. It does not contact a live relay,
mint, notary, Oracle service, wallet, or external API, and it does not handle
fund-bearing proofs or credentials.

## Run

From this directory:

```sh
deno task smoke
```

From the repository root:

```sh
deno task test:examples
```

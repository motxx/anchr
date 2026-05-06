# @anchr/sdk

Customer + Provider orchestration for the Anchr verified-data exchange:
Nostr DVM events (NIP-90) over Cashu HTLC settlement.

## Install

```sh
deno add @anchr/sdk
# or
npm i @anchr/sdk
```

## Customer

```ts
import { createCustomer, createCashuClient, createHttpOracleClient } from "@anchr/sdk";

const customer = createCustomer({
  oracles: ["npub1oracle1..."],
  relays:  ["wss://relay.example.org"],
  mint:    "https://mint.example.org",
  oracleClient: createHttpOracleClient({
    endpoint: "https://oracle.example.org",
    oraclePubkey: "npub1oracle1...",
  }),
  cashuClient: createCashuClient({ mintUrl: "https://mint.example.org" }),
});

const result = await customer.request({
  spec: {
    schema: "io.anchr.tlsn-https.v1",
    predicate: { target: "https://api.github.com/users/alice" },
  },
  payment: { maxAmount: 1000 },
  sourceProofs: cashuProofsFromYourWallet,
});

console.log(result.data, result.proof, result.providerPubkey);
```

## Provider

```ts
import { createProvider, createCashuClient } from "@anchr/sdk";

const provider = createProvider({
  oracles: ["npub1oracle1..."],
  relays:  ["wss://relay.example.org"],
  mint:    "https://mint.example.org",
  privKey: "nsec1...",
  cashuClient: createCashuClient({ mintUrl: "https://mint.example.org" }),
});

await provider.serve(async (request) => {
  // Decide whether to quote and at what price; return null to decline.
  return {
    amountSats: 100,
    produce: async () => ({
      data: { /* schema-specific payload */ },
      proof: /* schema-specific proof bytes/string */,
    }),
  };
});
```

## Schema URIs

The SDK is verification-format-agnostic. Each request carries a `schema` URI;
the provider's handler interprets it. URIs the SDK ships as constants:

| URI | Meaning |
|---|---|
| `io.anchr.tlsn-https.v1` | TLSNotary attestation of an HTTPS response |
| `io.anchr.c2pa-image.v1` | C2PA-signed photo / video |

The SDK does not bundle producers or verifiers. Wire your own
`produce(): Promise<{ data, proof }>` in the provider handler, and pass an
optional `schemaVerifiers` registry on the customer if you want local
verification of returned proofs.

## Testing

The default `cashuClient` and `relayClient` open live connections.
For unit tests, inject your own:

```ts
import type { CashuWalletAdapter, RelayClient } from "@anchr/sdk";

const customer = createCustomer({
  /* ... */,
  cashuClient: createCashuClient({ mintUrl, wallet: fakeWalletAdapter }),
  relayClient: fakeRelayClient,
});
```

Real e2e coverage against a regtest Cashu mint and Nostr relay lives at
`e2e/regtest/sdk-integration.test.ts` in this repo.

## License

MIT

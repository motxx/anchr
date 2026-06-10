# @anchr/sdk

Customer, Provider, and Oracle orchestration for verifiable paid requests: Nostr
transport over Cashu HTLC settlement with proof verification.

The actor SDK APIs below are the primary integration path. Anchr has no default
hosted server, mandatory REST API, or root hosted-server client. App-owned HTTP
gateways should use explicit adapters outside the root SDK contract.

## Install

```sh
deno add @anchr/sdk
# or
npm i @anchr/sdk
```

Workspace consumers can also pin the Deno import map directly:

```jsonc
{
  "imports": {
    "@anchr/sdk": "jsr:@anchr/sdk@^0.0.1"
  }
}
```

## Customer

```ts
import {
  type CashuProof,
  createCashuClient,
  createCustomer,
  createRelayClient,
  ProofSchema,
} from "@anchr/sdk";

const mintUrl = "https://mint.test.example";
const relayUrls = ["wss://relay.test.example"];
const oraclePubkey = "npub1exampleoraclepubkey";
const cashuProofsFromYourWallet: CashuProof[] = [];

const customer = createCustomer({
  // The Oracle hash bootstrap rides the relay as NIP-44 DMs by default;
  // pass `client: createHttpOracleClient(...)` per oracle to use HTTP.
  oracles: [{ pubkey: oraclePubkey }],
  relays: relayUrls,
  mint: mintUrl,
  cashuClient: createCashuClient({ mintUrl }),
  relayClient: createRelayClient(relayUrls),
});

const result = await customer.request({
  spec: {
    schema: ProofSchema.TlsnV1,
    predicate: { target: "https://api.github.com/users/alice" },
  },
  payment: { maxAmount: 1000 },
  sourceProofs: cashuProofsFromYourWallet,
});

console.log(result.data, result.proof, result.providerPubkey);
```

For a multi-oracle whitelist, keep `oracles` as the trust policy; entries
default to the relay-DM bootstrap, and an HTTP oracle is an explicit
per-entry override:

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
    { pubkey: oracleA },
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

## Provider

```ts
import {
  createCashuClient,
  createProvider,
  createRelayClient,
} from "@anchr/sdk";

const mintUrl = "https://mint.test.example";
const relayUrls = ["wss://relay.test.example"];
const oraclePubkey = "npub1exampleoraclepubkey";

const provider = createProvider({
  oracles: [oraclePubkey],
  relays: relayUrls,
  mint: mintUrl,
  privKey: "provider-secret-key-placeholder",
  cashuClient: createCashuClient({ mintUrl }),
  relayClient: createRelayClient(relayUrls),
});

await provider.serve(async (request) => {
  // Decide whether to offer and at what price; return null to decline.
  return {
    amountSats: 100,
    produce: async () => ({
      data: {/* schema-specific payload */},
      proof: "schema-specific-proof-placeholder",
    }),
  };
});
```

Provider implementations must preflight a selected escrow before irreversible
work and keep redeem decisions narrower than clean-settlement or audit
decisions. The normative rules live in `specs/paid-request-exchange.md` and
`docs/threat-model.md`.

## Proofs

Each request carries a `schema` URL; the provider's handler interprets it. URLs
the SDK ships as constants:

| URL                                               | Meaning                                    |
| ------------------------------------------------- | ------------------------------------------ |
| `https://anchr-spec.org/spec/proof/tlsn/v1`       | TLSNotary attestation of an HTTPS response |
| `https://anchr-spec.org/spec/proof/c2pa-image/v1` | C2PA-signed photo / video                  |

Wire your own `produce(): Promise<{ data, proof }>` in the provider handler.
Standard verifier helpers for TLSNotary, C2PA, EXIF, ProofMode, AI-content, and
GPS checks are exported from `@anchr/sdk/proofs` for Oracle and app-owned
verification policies.

## Testing

The default `cashuClient` and `relayClient` open live connections. For unit
tests, inject your own:

```ts
import {
  type CashuClient,
  createCustomer,
  createHttpOracleClient,
  type RelayClient,
} from "@anchr/sdk";

const mintUrl = "https://mint.test.example";
const relayUrls = ["wss://relay.test.example"];
const oraclePubkey = "npub1exampleoraclepubkey";

const fakeCashuClient: CashuClient = {
  mintUrl,
  async buildHtlcLock() {
    return { token: "cashu-test-token", amountSats: 1000, proofs: [] };
  },
  async bindProvider() {
    return { token: "cashu-test-token", amountSats: 1000, proofs: [] };
  },
  async redeemHtlc() {
    return { amountSats: 1000, proofs: [] };
  },
};

const fakeRelayClient: RelayClient = {
  async publish() {
    return { successes: relayUrls, failures: [] };
  },
  subscribe() {
    return { close() {} };
  },
  close() {},
};

const customer = createCustomer({
  oracles: [{
    pubkey: oraclePubkey,
    client: createHttpOracleClient({
      endpoint: "https://oracle.test.example",
    }),
  }],
  relays: relayUrls,
  mint: mintUrl,
  cashuClient: fakeCashuClient,
  relayClient: fakeRelayClient,
});
```

Real e2e coverage against a regtest Cashu mint and Nostr relay lives at
`e2e/regtest/sdk-integration.test.ts` in this repo.

## License

MIT

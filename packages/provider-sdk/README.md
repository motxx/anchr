# @anchr/provider-sdk

Provider-side SDK for discovering Customer requests, submitting quotes,
producing proof-backed results, and redeeming settlement after Oracle release.

Runtime-dependent relay and wallet integrations stay behind injected ports.

The SDK core requires explicit adapters:

- `relayClient` for actor transport. `createRelayClient()` is the bundled Nostr
  reference adapter.
- `cashuClient` for settlement and redeem. `createCashuClient()` is the bundled
  Cashu HTLC reference adapter.
- `proofGenerators` for proof production. TLSNotary, C2PA, or other proof
  engines should be supplied as adapters selected by schema URL.

Constructors do not create runtime clients implicitly. Apps choose concrete
adapters so Provider flow logic remains independent of a specific relay,
settlement backend, proof engine, or runtime.

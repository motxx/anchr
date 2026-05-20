# @anchr/provider-sdk

Provider-side SDK for discovering Customer requests, submitting offers,
producing proof-backed results, and redeeming settlement after Oracle release.

Runtime-dependent relay and wallet integrations stay behind injected ports.

## Install

```jsonc
{
  "imports": {
    "@anchr/provider-sdk": "jsr:@anchr/provider-sdk@^0.1"
  }
}
```

The SDK core requires explicit adapters:

- `relayClient` for actor transport. `createRelayClient()` from
  `@anchr/adapters/nostr` is the shared Nostr reference adapter.
- `cashuClient` for settlement and redeem. `createCashuClient()` from
  `@anchr/adapters/cashu` is the shared Cashu HTLC reference adapter.
- `proofGenerators` for proof production. TLSNotary, C2PA, or other proof
  engines should be supplied as adapters selected by schema URL.
- `stateStore` when the app wants durable local Provider progress.
  `@anchr/adapters/storage` provides memory and IndexedDB stores.

Constructors do not create runtime clients implicitly. Apps choose concrete
adapters so Provider flow logic remains independent of a specific relay,
settlement backend, proof engine, or runtime.

Proof generation stays behind `proofGenerators`; TLSNotary prover wasm or
browser-extension integrations are not bundled by the SDK core.

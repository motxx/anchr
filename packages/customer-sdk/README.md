# @anchr/customer-sdk

Customer-side SDK for creating Anchr requests, collecting Provider offers,
locking Cashu payment, selecting a Provider, and verifying the returned result.

Runtime-dependent pieces such as relays, wallets, or Oracle access are injected
through ports.

## Install

```jsonc
{
  "imports": {
    "@anchr/customer-sdk": "jsr:@anchr/customer-sdk@^0.1"
  }
}
```

The SDK core requires explicit adapters:

- `relayClient` for actor transport. `createRelayClient()` from
  `@anchr/adapters/nostr` is the shared Nostr reference adapter.
- `cashuClient` for settlement. `createCashuClient()` from
  `@anchr/adapters/cashu` is the shared Cashu HTLC reference adapter.
- `oracles: [{ pubkey, client }]` for the trusted oracle pubkey and its
  hash/release authority access.
- `stateStore` when the app wants durable local Customer progress.
  `@anchr/adapters/storage` provides memory and IndexedDB stores.

Constructors do not create runtime clients implicitly. Apps choose the concrete
adapters so browser, Node, Deno, and test runtimes can replace Nostr, Cashu, or
Oracle access without changing Customer flow logic.

Browser apps can use `createIndexedDbStateStore()` from
`@anchr/adapters/storage` for local request state and `createNip07Signer()` from
`@anchr/protocol/nostr` when they need a NIP-07 browser signer for app-owned
Nostr events. The Customer escrow flow still uses a per-request keypair because
refund and HTLC binding require local signing material.

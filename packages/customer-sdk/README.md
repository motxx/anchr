# @anchr/customer-sdk

Customer-side SDK for creating Anchr requests, collecting Provider offers,
locking Cashu payment, selecting a Provider, and verifying the returned result.

Runtime-dependent pieces such as relays, wallets, or Oracle access are injected
through ports.

The SDK core requires explicit adapters:

- `relayClient` for actor transport. `createRelayClient()` is the bundled Nostr
  reference adapter.
- `cashuClient` for settlement. `createCashuClient()` is the bundled Cashu HTLC
  reference adapter.
- `oracleClient` for hash/release authority access.
- `stateStore` when the app wants durable local Customer progress. The bundled
  memory store works in browser, Node, Deno, and workers; the IndexedDB store is
  the browser reference adapter.

Constructors do not create runtime clients implicitly. Apps choose the concrete
adapters so browser, Node, Deno, and test runtimes can replace Nostr, Cashu, or
Oracle access without changing Customer flow logic.

Browser apps can use `createIndexedDbStateStore()` for local request state and
`createNip07Signer()` from `@anchr/protocol/nostr` when they need a NIP-07
browser signer for app-owned Nostr events. The Customer escrow flow still uses a
per-request keypair because refund and HTLC binding require local signing
material.

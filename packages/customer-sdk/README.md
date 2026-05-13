# @anchr/customer-sdk

Customer-side SDK for creating Anchr requests, collecting Provider quotes,
locking Cashu payment, selecting a Provider, and verifying the returned result.

Runtime-dependent pieces such as relays, wallets, or Oracle access are injected
through ports.

The SDK core requires explicit adapters:

- `relayClient` for actor transport. `createRelayClient()` is the bundled Nostr
  reference adapter.
- `cashuClient` for settlement. `createCashuClient()` is the bundled Cashu HTLC
  reference adapter.
- `oracleClient` for hash/release authority access.

Constructors do not create runtime clients implicitly. Apps choose the concrete
adapters so browser, Node, Deno, and test runtimes can replace Nostr, Cashu, or
Oracle access without changing Customer flow logic.

# @anchr/adapters

Shared concrete adapters for actor SDK ports.

- `@anchr/adapters/cashu`: Cashu HTLC client backed by `@cashu/cashu-ts`.
- `@anchr/adapters/nostr`: Nostr relay transport adapter.
- `@anchr/adapters/storage`: memory and IndexedDB actor state stores.

Actor SDK packages define orchestration and accept these adapters through
explicit ports. They do not construct relay, wallet, or state implementations
internally.

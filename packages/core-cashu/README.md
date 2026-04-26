# core-cashu

Cashu HTLC escrow + preimage store helpers, decoupled from any specific application.

## Scope

- **HTLC escrow** — `createHtlcToken`, `redeemHtlcToken`, `swapHtlcBindWorker`, `verifyHtlcProofs`
- **P2PK escrow (legacy 2-of-2)** — `buildEscrowP2PKOptions`, `inspectEscrowToken`, `calculateOracleFee`
- **Escrow helpers** — `getWalletAndConfig`, `encodeProofs`, `loadAndSend`, `computeNetAmount`, `sumProofAmounts`
- **Preimage store** — `createPreimageStore`, `createPersistentPreimageStore`, `PreimageStore` / `PreimageEntry` interfaces

## Public API

```typescript
import {
  createHtlcToken, redeemHtlcToken, swapHtlcBindWorker,
  verifyHtlcProofs, buildEscrowP2PKOptions,
  inspectEscrowToken, calculateOracleFee,
  type EscrowToken, type EscrowParams,
} from "core-cashu/escrow";
import {
  getWalletAndConfig, encodeProofs, loadAndSend,
  computeNetAmount, sumProofAmounts,
} from "core-cashu/escrow-helpers";
import {
  createPreimageStore, createPersistentPreimageStore,
  type PreimageStore, type PreimageEntry,
} from "core-cashu/preimage-store";
```

## Host integration points

Two cross-boundary imports are intentional, not migration debt:

- `escrow-helpers` reads Cashu wallet bindings from the host
  (`src/infrastructure/cashu/wallet`) which configures the mint URL via env vars.
- `preimage-store` re-exports the `PreimageStore` / `PreimageEntry` port
  interfaces defined by the host application
  (`src/application/preimage-port`).

These keep this package agnostic of the specific Cashu mint configuration
and the host's port abstractions.

## Tests

```bash
deno test packages/core-cashu/ --allow-all
```

## License

MIT

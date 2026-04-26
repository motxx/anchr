# @anchr/core-cashu

Cashu HTLC escrow + preimage store helpers. Self-contained — bring your own Cashu mint.

## Install

```jsonc
{
  "imports": {
    "@anchr/core-cashu": "jsr:@anchr/core-cashu@^0.1"
  }
}
```

## Public API

```typescript
import {
  // HTLC escrow
  createHtlcToken, redeemHtlcToken, swapHtlcBindWorker,
  verifyHtlcProofs,
  // 2-of-2 P2PK escrow primitives
  buildEscrowP2PKOptions, inspectEscrowToken, calculateOracleFee,
  type EscrowToken, type EscrowParams,
} from "@anchr/core-cashu/escrow";

import {
  getWalletAndConfig, encodeProofs, loadAndSend,
  computeNetAmount, sumProofAmounts,
} from "@anchr/core-cashu/escrow-helpers";

import {
  createPreimageStore, createPersistentPreimageStore,
  type PreimageStore, type PreimageEntry,
} from "@anchr/core-cashu/preimage-store";

import {
  getCashuWallet, getCashuConfig, isCashuEnabled,
  createBountyToken, encodeToken, verifyToken,
} from "@anchr/core-cashu/wallet";
```

## Configuration

Set the mint URL via environment:

```bash
CASHU_MINT_URL=https://mint.example.com
```

`getCashuConfig()` returns `null` if unset, allowing graceful no-op behaviour in test environments.

## Tests

```bash
deno task test
```

## Dependencies

- `@cashu/cashu-ts` — Cashu protocol implementation
- `@noble/hashes` — SHA-256

## License

MIT

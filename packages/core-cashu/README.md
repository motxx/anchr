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
  buildHtlcFinalOptions, buildHtlcInitialOptions,
  buildHtlcPreselectionOptions, createHtlcToken,
  redeemHtlcToken, swapHtlcBindWorker, verifyHtlcProofs,
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

## HTLC Phases

`@anchr/core-cashu` owns the canonical Cashu HTLC/P2PK construction. Phase 1
has two valid modes:

- **Local hold:** `buildHtlcInitialOptions()` returns `null`; the Requester keeps
  plain proofs private until a Worker is selected. Do not publish those proofs.
- **Preselection transfer:** `buildHtlcPreselectionOptions()` creates a
  P2PK(Requester) lock for flows that need to show a bounty token before Worker
  selection. It omits the hashlock so the Requester can still sign and swap the
  proofs into the final Worker-bound HTLC.

Phase 2 is always `buildHtlcFinalOptions()`: hashlock(preimage) + P2PK(Worker)
+ locktime refund to the Requester.

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

# cashu-conditional-swap

N:M binary outcome conditional swap primitive on Cashu.

Brand-neutral: usable beyond Anchr — prediction markets, parametric insurance, group bounties, auctions, anywhere binary outcome settlement is needed.

## Scope

Two complementary swap mechanisms:

1. **HTLC dual-preimage** (`cross-htlc.ts`, `dual-preimage-store.ts`)
   - Oracle generates two preimages, one per outcome
   - Tokens locked with hashlock(outcome_hash) + P2PK(counterparty) + locktime + refund
   - Oracle reveals winning preimage; loser's preimage is destroyed
2. **FROST dual-key** (`frost-conditional-swap.ts`, `frost-dual-key-store.ts`)
   - Oracle holds FROST group keypairs, one per outcome
   - Tokens locked with P2PK([group_pubkey, winner_pubkey], n_sigs=2)
   - Oracle signs with the winning side's key; loser's key share is deleted
   - Per-proof signing for NUT-11 P2PK redemption (`signProofSecrets`)

## Public API

```typescript
import {
  createSwapPairTokens,
  buildCrossHtlcForPartyA,
  buildCrossHtlcForPartyB,
} from "cashu-conditional-swap/cross-htlc";
import {
  createDualPreimageStore,
  type DualPreimageStore,
} from "cashu-conditional-swap/dual-preimage-store";
import {
  buildFrostSwapForPartyA,
  buildFrostSwapForPartyB,
  createDualKeyStore,
  type DualKeyStore,
} from "cashu-conditional-swap/frost-conditional-swap";
import {
  createFrostDualKeyStore,
  createAdaptiveDualKeyStore,
} from "cashu-conditional-swap/frost-dual-key-store";
import type {
  ConditionalSwapDef, FrostConditionalSwapDef, SwapPair,
} from "cashu-conditional-swap/conditional-swap-types";
```

## Tests

```bash
deno test packages/cashu-conditional-swap/ --allow-all
```

## Dependencies

- `core-cashu` — for `EscrowToken`, `escrow-helpers`, `preimage-store`
- `cashu-frost-oracle` — for FROST signing coordination

## License

MIT

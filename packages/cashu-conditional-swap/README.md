# @anchr/cashu-conditional-swap

N:M binary outcome conditional swap primitive on Cashu. Brand-neutral — usable
beyond Anchr for two-party binary bets, parametric insurance, group bounties,
auctions, dispute escrow, anywhere binary outcome settlement is required.

## Install

```jsonc
{
  "imports": {
    "@anchr/cashu-conditional-swap": "jsr:@anchr/cashu-conditional-swap@^0.1",
    "@anchr/core-cashu": "jsr:@anchr/core-cashu@^0.1",
    "@anchr/frost-oracle": "jsr:@anchr/frost-oracle@^0.1"
  }
}
```

## Two complementary swap mechanisms

Each matched pair forms a **bilateral cross-lock**: each side's tokens are
locked under the _counterparty's_ pubkey and the _opposite outcome's_ hash (or
outcome group key in FROST mode). Neither side can redeem alone, the matchmaker
never custodies funds, and the Oracle holds only the secret that selects the
winner — not the funds themselves.

### 1. HTLC dual-preimage

Oracle generates two preimages, one per outcome. Tokens are locked with
`hashlock(outcome_hash) + P2PK(counterparty) + locktime + refund(self)`. Oracle
reveals the winning preimage; the loser's preimage is destroyed (one-time
semantics).

### 2. FROST dual-key

Oracle holds FROST group keypairs, one per outcome. Tokens are locked with
`P2PK([group_pubkey_outcome, winner_pubkey], n_sigs=2)`. Oracle signs through
the async release-authority port with the winning side's key; loser's signing
path is no longer available after release. Per-proof signing uses
`releaseProofSecretSignatures` for NUT-11 P2PK redemption.

## Public API

```typescript
import {
  buildCrossHtlcForPartyA,
  buildCrossHtlcForPartyB,
  createSwapPairTokens,
} from "@anchr/cashu-conditional-swap/cross-htlc";

import {
  createDualPreimageStore,
  type DualPreimageStore,
} from "@anchr/cashu-conditional-swap/dual-preimage-store";

import {
  buildFrostSwapForPartyA,
  buildFrostSwapForPartyB,
  createDualKeyStore,
  type DualKeyStore,
} from "@anchr/cashu-conditional-swap/frost-conditional-swap";

import {
  type BinaryOutcomeReleaseAuthority,
  createAdaptiveReleaseAuthority,
  createFrostReleaseAuthority,
  createSingleKeyReleaseAuthority,
} from "@anchr/cashu-conditional-swap/frost-dual-key-store";

import type {
  ConditionalSwapDef,
  FrostConditionalSwapDef,
  SwapPair,
} from "@anchr/cashu-conditional-swap/conditional-swap-types";
```

## Tests

```bash
deno task test
```

Tests cover all HTLC / FROST swap scenarios + 6 attack scenarios (locktime race,
dual signing, cross-market replay, per-proof mismatch, FROST collusion,
double-spend).

## Dependencies

- `@anchr/core-cashu` — `EscrowToken`, escrow helpers, preimage store
- `@anchr/frost-oracle` — FROST signing coordination
- `@cashu/cashu-ts` — Cashu protocol (P2PK, HTLC builders)
- `@noble/curves`, `@noble/hashes`, `nostr-tools` — Schnorr signing primitives

## License

MIT

# cashu-frost-oracle

FROST t-of-n threshold signing toolkit for Cashu P2PK.

Brand-neutral: this package is a generic FROST cluster toolkit usable beyond Anchr — multi-sig Cashu vaults, DAO treasuries, distributed escrow services, dispute-resolution juries.

## Scope

- **DKG protocol** — round-1/2/3 distributed key generation orchestration
- **Threshold signing** — round-1/2 commitments + signature shares + aggregation
- **Coordinator** — `createFrostCoordinator()` for in-process multi-signer state
- **Signing coordinator** — `coordinateSigning()` for cross-node HTTP coordination
- **CLI wrapper** — `signRound1`, `signRound2`, `dkgRound1/2/3`, `aggregateSignatures` invoke the upstream `frost-secp256k1-tr` Rust binary
- **Configuration** — `FrostNodeConfig`, `MarketFrostNodeConfig`, JSON file loaders

Companion Rust crate: `crates/frost-signer/` (RFC 9591 / Komlo-Goldberg via ZcashFoundation `frost-secp256k1-tr`).

## Public API

```typescript
import { createFrostCoordinator, type FrostCoordinator } from "cashu-frost-oracle/coordinator";
import {
  coordinateSigning,
  type SigningCoordinatorConfig,
} from "cashu-frost-oracle/signing-coordinator";
import {
  signRound1, signRound2, dkgRound1, dkgRound2, dkgRound3,
  aggregateSignatures, isFrostSignerAvailable,
} from "cashu-frost-oracle/frost-cli";
import {
  loadFrostNodeConfig, saveFrostNodeConfig,
  type FrostNodeConfig, type PeerConfig,
} from "cashu-frost-oracle/config";
import {
  loadMarketFrostNodeConfig,
  type MarketFrostNodeConfig,
} from "cashu-frost-oracle/market-frost-config";
import type {
  ThresholdOracleConfig, FrostSigningSession, DkgSession,
} from "cashu-frost-oracle/types";
```

## Tests

```bash
deno test packages/cashu-frost-oracle/ --allow-all
```

Tests skip gracefully when the `frost-signer` Rust binary is not built. To exercise the full DKG / signing path:

```bash
cd crates/frost-signer && cargo build --release
```

## License

MIT

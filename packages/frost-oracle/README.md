# @anchr/frost-oracle

FROST t-of-n threshold signing toolkit for Cashu P2PK. Brand-neutral — usable beyond Anchr for any Bitcoin / Cashu app that needs a threshold-signing Oracle.

Use cases: multi-sig Cashu vaults with social recovery, DAO treasuries, dispute-resolution juries, distributed escrow services, two-party-binary-bet oracles.

## Install

```jsonc
{
  "imports": {
    "@anchr/frost-oracle": "jsr:@anchr/frost-oracle@^0.1",
    "@anchr/core-runtime": "jsr:@anchr/core-runtime@^0.1"
  }
}
```

## Companion Rust binary

Built from `frost-secp256k1-tr` (ZcashFoundation, RFC 9591 / Komlo-Goldberg, BIP-340 Taproot compatible). Path resolution: project-local `crates/frost-signer/target/release/frost-signer` → `PATH`.

```bash
git clone https://github.com/motxx/anchr.git
cd anchr/crates/frost-signer && cargo build --release
```

If the binary is absent, signing functions return `null` and the package gracefully no-ops.

## Public API

```typescript
import { createFrostCoordinator, type FrostCoordinator } from "@anchr/frost-oracle/coordinator";
import { coordinateSigning, type SigningCoordinatorConfig } from "@anchr/frost-oracle/signing-coordinator";
import {
  signRound1, signRound2, dkgRound1, dkgRound2, dkgRound3,
  aggregateSignatures, isFrostSignerAvailable,
} from "@anchr/frost-oracle/frost-cli";
import {
  loadFrostNodeConfig, saveFrostNodeConfig,
  type FrostNodeConfig, type PeerConfig,
} from "@anchr/frost-oracle/config";
import {
  loadMarketFrostNodeConfig,
  type MarketFrostNodeConfig,
} from "@anchr/frost-oracle/market-frost-config";
import type {
  ThresholdOracleConfig, FrostSigningSession, DkgSession,
} from "@anchr/frost-oracle/types";
```

## Tests

```bash
deno task test
```

Tests skip gracefully when the `frost-signer` Rust binary is not built.

## Dependencies

- `@anchr/core-runtime` — for `spawn` to invoke the Rust binary, plus shared logger
- `hono` — for the HTTP signing-coordinator (RPC between cluster nodes)
- `ThresholdOracleConfig` is defined locally at `@anchr/frost-oracle/types`.

## License

MIT

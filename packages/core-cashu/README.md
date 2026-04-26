# core-cashu

Cashu HTLC escrow + preimage store helpers, decoupled from any specific application.

## Status

🚧 **WIP — extracted from anchr monorepo (2026-04-26)**

## Public API

```typescript
import type { EscrowToken } from "core-cashu/escrow";
import { getWalletAndConfig, encodeProofs, loadAndSend, computeNetAmount } from "core-cashu/escrow-helpers";
import { createPreimageStore, type PreimageStore } from "core-cashu/preimage-store";
```

## License

MIT

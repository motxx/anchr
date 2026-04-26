# photo-bounty

Cryptographically verified photo / video bounty primitives.

## Status

🚧 **WIP — being extracted from anchr monorepo (started 2026-04-26)**

See [`docs/refactor-plan.md`](../../docs/refactor-plan.md) for extraction progress.

## Scope

This package owns photo/video evidence verification:

- **C2PA** — Content Credentials manifest chain verification
- **EXIF** — metadata extraction + GPS validation
- **ProofMode** — open-source mobile proof verification
- **AI content check** — heuristic + LLM-based AI-generated detection
- **Geo** — Haversine distance for GPS proximity checks

Out of scope (lives elsewhere):
- TLSNotary verification (separate product: `tlsn-fiat-swap`, `tlsn-auto-claim`, etc.)
- Cashu payment binding (shared core: `core-cashu-bind`)
- Nostr discovery (shared core: `core-nostr-dvm`)

## Public API (planned)

```typescript
import { haversineKm } from "photo-bounty/geo";
import { validateC2pa } from "photo-bounty/c2pa";
import { validateExif, extractExifMetadata } from "photo-bounty/exif";
import { parseProofModeZip } from "photo-bounty/proofmode";
import { checkAttachmentContent } from "photo-bounty/ai-check";
```

## License

MIT

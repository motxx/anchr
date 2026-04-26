# photo-bounty

Cryptographically verified photo / video bounty primitives for Anchr.

## Scope

This package owns photo/video evidence verification:

- **C2PA** — Content Credentials manifest chain verification (`validateC2pa`)
- **EXIF** — metadata extraction + GPS validation (`validateExif`, `extractExifMetadata`)
- **ProofMode** — open-source mobile proof verification (`parseProofModeZip`)
- **AI content check** — heuristic + LLM-based AI-generated detection (`createAiContentChecker`, DI)
- **Geo** — Haversine distance for GPS proximity checks (`haversineKm`)
- **Integrity store** — keep verification metadata across upload → verify boundary

Out of scope (lives elsewhere):
- TLSNotary verification (separate package: `tlsn-toolkit`)
- Cashu payment binding (separate package: `core-cashu`)
- Nostr discovery (host server in `src/infrastructure/nostr`)

## Public API

```typescript
import { haversineKm } from "photo-bounty/geo";
import { validateC2pa, isC2paAvailable } from "photo-bounty/c2pa-validation";
import { validateExif, extractExifMetadata } from "photo-bounty/exif-validation";
import { parseProofModeZip } from "photo-bounty/proofmode-validation";
import { createAiContentChecker } from "photo-bounty/ai-content-check";
import { createIntegrityStore, storeIntegrity, getIntegrity } from "photo-bounty/integrity-store";
```

## Tests

```bash
deno test packages/photo-bounty/ --allow-all
```

Tests skip gracefully when `c2patool`, `unzip`, or `gpg` are not installed.

## License

MIT

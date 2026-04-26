# @anchr/photo-bounty

Cryptographically verified photo / video evidence: C2PA Content Credentials, EXIF metadata, ProofMode bundles, AI-generated detection (heuristic + vision-LLM), GPS Haversine distance, and an in-memory integrity store.

## Install

```jsonc
{
  "imports": {
    "@anchr/photo-bounty": "jsr:@anchr/photo-bounty@^0.1",
    "@anchr/core-runtime": "jsr:@anchr/core-runtime@^0.1",
    "@anchr/core-domain": "jsr:@anchr/core-domain@^0.1"
  }
}
```

## Optional system dependencies (graceful fallback if absent)

- `c2patool` — C2PA manifest verification (without it, `validateC2pa` returns `available: false`)
- `unzip` — ProofMode bundle extraction
- `gpg` — PGP signature verification on ProofMode

## Public API

```typescript
import { haversineKm } from "@anchr/photo-bounty/geo";
import { validateC2pa, isC2paAvailable } from "@anchr/photo-bounty/c2pa-validation";
import { validateExif, extractExifMetadata } from "@anchr/photo-bounty/exif-validation";
import { parseProofModeZip } from "@anchr/photo-bounty/proofmode-validation";
import { createAiContentChecker } from "@anchr/photo-bounty/ai-content-check";
import {
  createIntegrityStore, storeIntegrity, getIntegrity,
} from "@anchr/photo-bounty/integrity-store";
```

## AI content check (DI design)

`createAiContentChecker({ getConfig, readAttachment })` is a factory: inject your own config source and attachment reader so the package has no implicit dependency on host config or storage.

```typescript
const check = createAiContentChecker({
  getConfig: () => ({
    enabled: process.env.AI_CONTENT_CHECK === "true",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  }),
  readAttachment: async (ref, blossomKey) => {
    // your implementation
    return { data: buffer, mimeType: ref.mime_type };
  },
});

const result = await check(query, queryResult, blossomKeys);
```

## Tests

```bash
deno task test
```

Tests skip gracefully when optional binaries (`c2patool`, `unzip`, `gpg`) are not installed.

## Dependencies

- `@anchr/core-runtime` — for `spawn`, file I/O, `which`
- `@anchr/core-domain` — for `Query`, `QueryResult`, `AttachmentRef`, `BlossomKeyMap` types
- `@anthropic-ai/sdk` — for vision-LLM AI check (only used if `AI_CONTENT_CHECK=true`)
- `@noble/hashes` — for SHA-256 (ProofMode hash verification)

## License

MIT

# @anchr/photo-verification

Cryptographically verified photo / video evidence: C2PA Content Credentials,
EXIF metadata, ProofMode bundles, AI-generated detection (heuristic +
vision-LLM), GPS Haversine distance, and an in-memory integrity store.

## Install

```jsonc
{
  "imports": {
    "@anchr/photo-verification": "jsr:@anchr/photo-verification@^0.1"
  }
}
```

## Optional system dependencies (graceful fallback if absent)

- `c2patool` — C2PA manifest verification (without it, `validateC2pa` returns
  `available: false`)
- `unzip` — ProofMode bundle extraction
- `gpg` — PGP signature verification on ProofMode

## Public API

```typescript
import { haversineKm } from "@anchr/photo-verification/geo";
import {
  isC2paAvailable,
  validateC2pa,
} from "@anchr/photo-verification/c2pa-validation";
import {
  extractExifMetadata,
  validateExif,
} from "@anchr/photo-verification/exif-validation";
import { parseProofModeZip } from "@anchr/photo-verification/proofmode-validation";
import { createAiContentChecker } from "@anchr/photo-verification/ai-content-check";
import {
  createIntegrityStore,
  getIntegrity,
  storeIntegrity,
} from "@anchr/photo-verification/integrity-store";
```

## AI content check (DI design)

`createAiContentChecker({ getConfig, readAttachment })` is a factory: inject
your own config source and attachment reader so the package has no implicit
dependency on host config or storage.

```typescript
const check = createAiContentChecker({
  getConfig: () => ({
    enabled: Deno.env.get("AI_CONTENT_CHECK") === "true",
    anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY"),
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

Tests skip gracefully when optional binaries (`c2patool`, `unzip`, `gpg`) are
not installed.

## Dependencies

- `@anthropic-ai/sdk` — for vision-LLM AI check (only used if
  `AI_CONTENT_CHECK=true`)
- `@noble/hashes` — for SHA-256 (ProofMode hash verification)

The package's API is generic over the consumer's `AttachmentRef` shape (via
`AiContentCheckQuery` / `AiContentCheckResult<TRef>`); it carries no opinion on
the host's `Query` / `QueryResult` types.

## License

MIT

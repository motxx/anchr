# `@anchr/photo-bounty` — Implementation Spec

> **Scope:** photo / video evidence verification at the application
> layer that this package owns. The Oracle interface itself is a
> host-side contract; see `tlsn-toolkit/SPEC.md` for the shared shape.

## Verification Factors Owned by this Package

| Factor | Description |
|--------|-------------|
| `gps` | GPS proximity check (Haversine) against `expected_gps` |
| `nonce` | Challenge nonce visible in the photo (vision-LLM) |
| `timestamp` | Timestamp freshness on the photo's signed metadata |
| `c2pa` | C2PA Content Credentials manifest verified |
| `ai_check` | LLM-based content relevance check (advisory; see below) |

`gps`, `nonce`, `timestamp`, and `c2pa` are **deterministic**. `ai_check`
is **advisory** — different Oracles may produce different verdicts on
the same input, so its failures emit `warnings` rather than `failures`
and do not gate payment release. This keeps threshold-Oracle consensus
intact even when the underlying LLM is non-deterministic.

Default factor set for photo queries: `["gps", "ai_check"]`.

## How Photo Verification Works

1. Worker photographs the target with a C2PA-signed camera (or signs
   the capture via ProofMode).
2. C2PA Content Credentials are cryptographically bound to the image,
   GPS coordinates, and timestamp. ProofMode produces a parallel signed
   manifest archive.
3. Worker strips EXIF metadata for privacy (the host does this via
   `exif-strip-helpers`); the C2PA manifest is preserved.
4. Worker uploads the encrypted blob to Blossom (see
   `docs/host-storage.md`) and submits the proof.
5. Oracle independently verifies:
   - C2PA signature chain (via the `c2patool` companion binary)
   - ProofMode signature chain (via `gpg` companion binary)
   - GPS proximity to `expected_gps` within `max_gps_distance_km`
   - Optional challenge nonce visible in the image (vision-LLM)
   - Optional content-relevance check (`ai_check`, advisory)

## GPS Proximity Check

The Requester specifies `expected_gps: {lat, lon}` and
`max_gps_distance_km` (default: 50 km). The Oracle computes the Haversine
distance between the photo's signed GPS coordinates and the expected
location.

`packages/photo-bounty/src/geo.ts::haversineKm` implements the formula
deterministically.

## C2PA Verification

`validateC2pa()` shells out to `c2patool` and asserts:

- The manifest signature chain validates against a trusted root.
- The manifest's bound GPS / timestamp matches what the Worker
  submitted.
- The asset's hash matches the actual blob content.

If `c2patool` is not installed on the Oracle, `validateC2pa()` returns
`available: false` and the factor is skipped (the host's verifier marks
the query as failed if `c2pa` was a required factor).

## ProofMode Verification

`parseProofModeZip()` extracts a ProofMode bundle, verifies the
SHA-256-of-content + GPG signature chain, and returns the structured
manifest. Same fail-closed behavior when `gpg` is absent.

## Vision-LLM Content Check (advisory)

`createAiContentChecker()` is a dependency-injected factory. The host
adapter at `src/infrastructure/verification/ai-content-check.ts` injects
the `ANTHROPIC_API_KEY` reader and `readStoredAttachmentBuffer`. When
disabled (`AI_CONTENT_CHECK !== "true"` or no API key), the checker
returns `null` — the factor is silently skipped at the verifier layer.

When enabled, the LLM is prompted with the query description, the photo
(or extracted video frames via `ffmpeg`), and an optional challenge
nonce. The result becomes a `warning` if the model judges the photo
irrelevant — *never* a `failure`.

## Decoupling from Host Types

`createAiContentChecker<TRef>` is generic over the consumer's
`AttachmentRef` shape (`AttachmentRefBase`). The package does not depend
on the host's `Query` / `QueryResult` types — callers pass exactly the
fields the prompt builder reads (`description`, `challenge_nonce`,
`verification_requirements`).

## Test References

- Unit: `packages/photo-bounty/src/{geo,c2pa-validation,exif-validation,
  proofmode-validation,ai-content-check}.test.ts`
- E2E: `example/c2pa-media-verification/`,
  `example/supply-chain-proof/` (compose this package + Anchr host).
- Optional system binaries: `c2patool`, `unzip`, `gpg`, `ffmpeg`. Tests
  skip gracefully when any are absent.

# C2PA Media Verification

> **Status: Testnet.** Backed by `@anchr/photo-verification` and a testnut mint; not on mainnet.

> **Uses:** `anchr-sdk` → reference server (`@anchr/photo-verification` + `@anchr/cashu-conditional-swap`).
> **Pattern:** bounty (News desk pays Journalist on verified C2PA + GPS proof).

Prove that a news photo is a real camera capture — not AI-generated — using [C2PA Content Credentials](https://c2pa.org/) and Anchr's decentralized verification network.

## Problem

AI-generated images are now indistinguishable from real photographs. News desks can no longer trust that a photo was actually taken at the claimed location and time. Traditional metadata (EXIF) is trivially forgeable.

## Solution

Anchr combines **C2PA hardware-rooted signatures** with **GPS proximity checks** for cryptographic proof of camera capture, plus an **AI-generation heuristic** as a soft filter.

A news desk posts a bounty requesting a photo from a specific location. An on-ground journalist takes the photo with a C2PA-enabled camera, which embeds a hardware-signed Content Credential. Anchr's oracle verifies the credential chain, GPS proximity, and absence of AI generation markers before releasing payment.

## Architecture

```
News Desk (Requester)                    On-ground Journalist (Worker)
┌─────────────────────┐                  ┌──────────────────────────┐
│ anchr.photo({       │                  │ C2PA-enabled camera      │
│   expectedGps,      │  ── Nostr ──▶    │   ↓                      │
│   maxGpsDistanceKm, │                  │ Photo + Content Credential│
│   maxSats: 100      │                  │   ↓                      │
│ })                  │                  │ Upload to Anchr           │
└─────────────────────┘                  └──────────────────────────┘
         │                                          │
         │              ┌───────────┐               │
         └─────────────▶│  Oracle   │◀──────────────┘
                        │           │
                        │ 1. C2PA signature verify  │
                        │ 2. GPS proximity check    │
                        │ 3. AI generation check    │
                        │ 4. Timestamp freshness    │
                        └───────────┘
                              │
                        Verified photo +
                        cryptographic proof
```

## Verification Flow

1. **C2PA Signature Verification** — The oracle runs `c2patool` to validate the Content Credential chain. The signature is rooted in the camera's signing key — typically a hardware key in the TPM or secure enclave for compliant cameras. Forgery requires physical access to the device or a compromised software signer.

2. **GPS Proximity Check** — The oracle extracts GPS coordinates from the C2PA EXIF assertion (not from user-supplied metadata). The Haversine distance to the requested location must be within `max_gps_distance_km`.

3. **AI Generation Check** — Real camera photos contain EXIF fields like `Make` and `Model`. AI-generated images lack these. The oracle checks for their presence as a heuristic filter.

4. **Timestamp Freshness** — The C2PA `signatureInfo.time` must be recent relative to the query creation time, preventing replay of old photos.

## Trust Model

| Component | Trust Assumption |
|-----------|-----------------|
| C2PA signature | Rooted in the camera's signing key (typically hardware-protected on compliant cameras). Forgery requires either physical access or a compromised software signer |
| GPS coordinates | Extracted from C2PA-signed EXIF assertion — Worker cannot spoof without breaking the signature |
| AI detection | Heuristic only (EXIF camera model presence) — raises the bar but offers no cryptographic guarantee |
| Timestamp | Signed by the camera at capture time. Replay is bounded by freshness checks |
| Privacy | Server verifies EXIF on upload, strips it before storage, and persists only the result |

## Running the Example

```bash
# Start the Anchr server (from repo root)
deno task dev

# Terminal 1: News desk creates a photo request
deno task requester

# Terminal 2: Journalist uploads and submits a photo
deno task worker
```

### Prerequisites

- `c2patool` installed ([install guide](https://github.com/contentauth/c2patool))
- A C2PA-signed test image (or use `c2patool` to sign one for testing)

### Creating a Test Image

```bash
# Sign a test image with c2patool
c2patool test-photo.jpg -m manifest.json -o signed-photo.jpg
```

## Files

- **requester.ts** — News desk SDK demo: creates a photo verification query with GPS and bounty
- **worker.ts** — Journalist HTTP API demo: discovers queries, uploads C2PA photo, submits for verification

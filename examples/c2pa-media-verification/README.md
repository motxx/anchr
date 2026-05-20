# C2PA Media Verification

> **Status: Testnet.** Backed by `@anchr/photo-verification` and a testnut mint;
> not on mainnet.

> **Uses:** `anchr-sdk` Customer / Provider primitives, Nostr, Cashu HTLC, and
> an Oracle. No Anchr-operated host or reference `/queries` server is required.
> **Pattern:** bounty (Customer pays Provider on verified C2PA + GPS proof).

Prove that a news photo is a real camera capture — not AI-generated — using
[C2PA Content Credentials](https://c2pa.org/) and Anchr's decentralized
verification network.

## Problem

AI-generated images are now indistinguishable from real photographs. News desks
can no longer trust that a photo was actually taken at the claimed location and
time. Traditional metadata (EXIF) is trivially forgeable.

## Solution

Anchr combines **C2PA hardware-rooted signatures** with **GPS proximity checks**
for cryptographic proof of camera capture, plus an **AI-generation heuristic**
as a soft filter.

A Customer posts a bounty requesting a photo from a specific location. A
Provider takes the photo with a C2PA-enabled camera, which embeds a
hardware-signed Content Credential. Anchr's oracle verifies the credential
chain, GPS proximity, and absence of AI generation markers before releasing
payment.

## Architecture

```
Customer                                  Provider
┌─────────────────────┐                  ┌──────────────────────────┐
│ createCustomer      │                  │ createProvider           │
│   expectedGps,      │  ── Nostr ──▶    │   ↓                      │
│   maxGpsDistanceKm, │                  │ Photo + Content Credential│
│   maxSats: 100      │                  │   ↓                      │
│ })                  │                  │ kind 6300 encrypted result│
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

1. **C2PA Signature Verification** — The oracle runs `c2patool` to validate the
   Content Credential chain. The signature is rooted in the camera's signing key
   — typically a hardware key in the TPM or secure enclave for compliant
   cameras. Forgery requires physical access to the device or a compromised
   software signer.

2. **GPS Proximity Check** — The oracle extracts GPS coordinates from the C2PA
   EXIF assertion (not from user-supplied metadata). The Haversine distance to
   the requested location must be within `max_gps_distance_km`.

3. **AI Generation Check** — Real camera photos contain EXIF fields like `Make`
   and `Model`. AI-generated images lack these. The oracle checks for their
   presence as a heuristic filter.

4. **Timestamp Freshness** — The C2PA `signatureInfo.time` must be recent
   relative to the query creation time, preventing replay of old photos.

## Trust Model

| Component       | Trust Assumption                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C2PA signature  | Rooted in the camera's signing key (typically hardware-protected on compliant cameras). Forgery requires either physical access or a compromised software signer |
| GPS coordinates | Extracted from C2PA-signed EXIF assertion — Provider cannot spoof without breaking the signature                                                                 |
| AI detection    | Heuristic only (EXIF camera model presence) — raises the bar but offers no cryptographic guarantee                                                               |
| Timestamp       | Signed by the camera at capture time. Replay is bounded by freshness checks                                                                                      |
| Privacy         | Server verifies EXIF on upload, strips it before storage, and persists only the result                                                                           |

## Running the Example

```bash
# Copy the non-secret local template, then replace placeholders.
cp .env.example .env
```

Required services:

- Nostr relay, for Customer/Provider coordination.
- Cashu mint, for non-production HTLC settlement.
- Oracle HTTP endpoint, for hash and verification requests.
- Optional Blossom server, if you adapt the example to external attachments.
- Optional `c2patool`, if you need to create or validate C2PA test media.

```bash
# From the repository root: start local relay and Cashu dependencies.
docker compose up -d relay bitcoind lnd-mint lnd-user
./scripts/init-regtest.sh
docker compose up -d cashu-mint

# Terminal 1: Oracle HTTP endpoint.
ORACLE_PORT=3001 \
ORACLE_API_KEY=<optional-oracle-api-key> \
deno run --allow-all packages/bounty/src/infrastructure/oracle-service/server.ts

# Terminal 2: Provider listens for C2PA photo requests.
deno task worker -- signed-photo.jpg

# Terminal 3: Customer creates a photo request.
deno task requester
```

### Smoke Check

```bash
deno task smoke
```

The smoke check type-checks the Customer and Provider scripts against the
current SDK API and verifies that `.env.example` documents the required
non-secret configuration. It does not start relay, mint, Oracle, Blossom, or
`c2patool`; use the runbook for live-service validation.

### Prerequisites

- `c2patool` installed
  ([install guide](https://github.com/contentauth/c2patool))
- A C2PA-signed test image (or use `c2patool` to sign one for testing)

### Creating a Test Image

```bash
# Sign a test image with c2patool
c2patool test-photo.jpg -m manifest.json -o signed-photo.jpg
```

## Files

- **requester.ts** — Customer: publishes a NIP-90 photo request and
  locks Cashu proofs
- **worker.ts** — Provider: listens on Nostr, offers, and publishes
  an encrypted result

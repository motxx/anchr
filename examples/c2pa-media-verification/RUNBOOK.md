# C2PA Media Verification Runbook

This runbook validates the hostless Customer/Provider example with local,
non-production services. It does not use a shared Anchr reference host.

## 0. Smoke Check

```bash
cd examples/c2pa-media-verification
deno task smoke
```

The smoke check type-checks `requester.ts` and `worker.ts` against the current
SDK API and verifies that `.env.example` contains the required non-secret
configuration. It does not start relay, mint, Oracle, Blossom, or `c2patool`.

## 1. Configure

```bash
cd examples/c2pa-media-verification
cp .env.example .env
```

Replace these placeholders in `.env`:

- `ORACLE_PUBKEY`: Oracle authority pubkey accepted by the Customer and
  Provider.
- `ORACLE_API_KEY`: only when your local Oracle requires one.
- `C2PA_PROVIDER_PRIVKEY`: Provider signing key for Nostr messages.
- `C2PA_SOURCE_PROOFS_JSON`: non-production Cashu proofs from the local mint.
- `C2PA_PHOTO_PATH`: path to a C2PA-signed image, or pass the path to
  `deno task worker -- <path>`.

Do not commit `.env`, source ecash proofs, private keys, or real media that
contains private metadata.

## 2. Start Local Services

From the repository root:

```bash
docker compose up -d relay bitcoind lnd-mint lnd-user
./scripts/init-regtest.sh
docker compose up -d cashu-mint
```

Start the Oracle HTTP endpoint in its own terminal:

```bash
ORACLE_PORT=3001 \
ORACLE_API_KEY=<optional-oracle-api-key> \
deno run --allow-all packages/bounty/src/infrastructure/oracle-service/server.ts
```

Confirm the local services:

```bash
curl -fsS http://localhost:3001/health
curl -fsS http://localhost:3338/v1/info
```

## 3. Provider Side

In `examples/c2pa-media-verification`:

```bash
deno task worker -- signed-photo.jpg
```

The Provider listens on the configured Nostr relay, offers only
`https://anchr-spec.org/spec/proof/c2pa-image/v1` requests, and returns the
selected image as base64 proof data.

## 4. Customer Side

In another terminal:

```bash
deno task requester
```

The Customer publishes a C2PA image request, locks the configured testnet Cashu
proofs, waits for Provider offers, selects a Provider, and waits for the
Oracle-gated result.

## 5. C2PA Fixture

Use a C2PA-enabled camera image or create a local test fixture with
`c2patool`:

```bash
c2patool test-photo.jpg -m manifest.json -o signed-photo.jpg
```

A plain JPEG without C2PA or GPS metadata is useful as a negative fixture: the
Oracle should reject it when C2PA or GPS factors are required.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Provider never offers | `NOSTR_RELAYS`, `ORACLE_PUBKEY`, schema URL, and Customer max sats must match Provider policy. |
| Customer cannot lock payment | `C2PA_SOURCE_PROOFS_JSON` must contain spendable local Cashu proofs from `CASHU_MINT_URL`. |
| Oracle rejects verification | Confirm the image has a valid C2PA manifest and GPS when those factors are required. |
| Oracle returns 401 | Set the same `ORACLE_API_KEY` on the Oracle and in `.env`. |

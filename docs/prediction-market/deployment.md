# Prediction Market Deployment Guide

End-to-end operator runbook for deploying the Anchr prediction market on
**regtest** (local development) or **testnet** (public preview). The
production-style deploy uses encrypted FROST DKG keys (PR-D), the
auto-resolver (PR-B), trustless TLSNotary verification (PR-C), and the
browser-side Cashu bet flow (PR-E).

> **Live testnet deploy:** <https://anchr-market.fly.dev> (Fly region `sin`,
> testnut.cashu.space mint, anchr-relay Nostr relay, anchr-tlsn-verifier).

## Architecture at a glance

```
                           +----------------------------+
                           | TLSNotary verifier binary  |
                           |  (cryptographic proofs)    |
                           +-------------+--------------+
                                         ^
                                         |  /submit-resolution
                                         |  /resolve
                                         |
+-------------+   bet/lock/redeem   +----+----+    sign/redeem    +-----------+
|  Browser    |<------------------>|  Market  |<----------------->| FROST     |
| (Cashu UI)  |    (Hono routes)    |  Server  |                   | t-of-n    |
+------+------+                     +----+----+                    | cluster   |
       ^                                 ^                         +-----------+
       |  cashuB tokens                  |
       v                                 |  Lightning mint
+------+------+                     +----+----+
|  Cashu mint |<--------------------+  lnd    |
|  (Nutshell) |   pay invoice       +----------+
+-------------+
```

- **Browser** holds proofs in localStorage and creates P2PK-locked
  exchange tokens. Server never custodies funds.
- **Market server** is a pure matchmaker: `/markets`, `/bet`,
  `/submit-token`, `/resolve`, `/sign-proofs`, `/redeem`,
  `/wallet/config`, `/wallet/faucet`.
- **FROST cluster** issues threshold signatures over P2PK conditions
  when the market resolves. Pre-1.0, FROST is optional — if
  `FROST_MARKET_CONFIG_PATH` is unset, the server falls back to HTLC
  preimage reveal.

## 1. Local regtest (5 minutes)

This is the fastest way to play with the full flow on your machine.

```bash
# 1. Build UI bundle + tailwind CSS once
deno task build:ui
deno task build:css

# 2. Bring up Cashu mint + lnd + nostr relay
docker compose up -d
./scripts/init-regtest.sh
docker compose restart cashu-mint

# 3. Start the prediction market server
CASHU_MINT_URL=http://localhost:3338 \
NOSTR_RELAYS=ws://localhost:7777 \
MARKET_PORT=3001 \
deno run --config deno.json --allow-all example/two-party-binary-bet/server.ts
```

Open <http://localhost:3001>. You should see the empty-market home page
([screenshot](./screenshots/01-empty-markets.png)) with a `Cashu wallet`
banner that confirms the mint URL.

Click `+1,000 sats` in the wallet panel — that mints a fresh Cashu
token via regtest Lightning, swaps it at the mint, and credits your
browser-only balance.

## 2. Adding a FROST cluster (production-style settlement)

In production, you want a *t-of-n* threshold cluster instead of a single
HTLC preimage. PR-D's encrypted DKG bootstrap covers this.

```bash
# 1. Run distributed key generation for both YES and NO outcome groups.
#    The output is FROST signer config files, encrypted at rest with
#    AES-256-GCM and PBKDF2-SHA256 (600k iterations).
FROST_KEY_PASSPHRASE='choose-a-strong-passphrase' \
deno run --allow-all scripts/frost-market-dkg-bootstrap.ts \
  --threshold 2 --total 3 --output-dir .frost-market

# 2. Each signer node loads its own config. Boot the cluster.
deno run --allow-all scripts/frost-market-oracle-cluster.ts

# 3. Boot the market server pointing at signer-1's config.
FROST_MARKET_CONFIG_PATH=.frost-market/signer-1.json \
FROST_KEY_PASSPHRASE='same-passphrase-as-above' \
CASHU_MINT_URL=http://localhost:3338 \
deno run --config deno.json --allow-all example/two-party-binary-bet/server.ts
```

What changes for the user: tokens are P2PK-locked to a 2-of-2 multisig
of `[group_pubkey_no, counterparty_pubkey]` (for YES bettors) — to
unlock, the winner needs both the counterparty's signature *and* a
threshold FROST signature from the cluster. Compromising one signer
in a 2-of-3 deploy is not enough to settle dishonestly.

Loss-of-passphrase is unrecoverable. Back up
`.frost-market/signer-*.json` and the passphrase out-of-band.

## 3. Trustless resolution: TLSNotary

The auto-resolver in `auto-resolver.ts` polls every market past its
deadline and:

1. Fetches the truth-source URL through its **SSRF-hardened** fetcher
   (no redirects, 10 s timeout, 1 MiB body cap, allowlisted destinations
   via `ALLOW_LOCAL_TRUTH_SOURCES`).
2. Evaluates the market's `resolution_condition` on the body.
3. Settles via `settleMarket(...)`.

For full trustlessness, anyone (not just the operator) can submit a
TLSNotary proof of the truth-source response via
`POST /markets/:id/submit-resolution` with `{ tlsn_presentation }`. The
server cryptographically verifies the proof, then evaluates the
condition. **No one needs to be trusted to read the URL** — the
binding is `(server name, response body, session timestamp)`, all
covered by the TLSNotary signature.

This requires the TLSNotary verifier binary on the host:

```bash
cd crates/tlsn-verifier && cargo build --release
```

## 4. Public testnet deploy on Fly.io

Ship the market with FROST 2-of-3 threshold signing, fronted by Fly's
managed TLS, using the existing public testnut Cashu mint and the
already-deployed Anchr Nostr relay + TLSN verifier.

### Architecture (single-VM, multi-process)

```
+---------------------- anchr-market.fly.dev ----------------------+
|                                                                  |
|  scripts/market-cluster-entrypoint.ts (PID 1, tini)              |
|    ├── frost-signer-1   (127.0.0.1:4001)                         |
|    ├── frost-signer-2   (127.0.0.1:4002)                         |
|    ├── frost-signer-3   (127.0.0.1:4003)                         |
|    └── market-server    (0.0.0.0:8080)  ←── Fly proxy → :443     |
|                                                                  |
|  /data (persistent volume) holds the decrypted signer-N.json     |
+------------------------------------------------------------------+
        │                              │
        ▼                              ▼
  testnut.cashu.space            anchr-relay.fly.dev
  (public Cashu mint)            (Nostr relay, kind 30078)
        │
        ▼
  anchr-tlsn-verifier.fly.dev    (TLSN proxy, used by browser
                                   to produce attestations)
```

Three FROST signer shares live in distinct processes (so they don't
share an address space) but the same Fly machine. That's the threshold
crypto guarantee, not geo-distribution — the next iteration is splitting
into three Fly apps.

### One-time setup (recommended: GitHub Actions)

The fastest way is the **Bootstrap Anchr Market** workflow. It creates
the Fly app + volume idempotently, runs DKG inside the runner, uploads
the encrypted shares + passphrase as Fly secrets, then deploys.

1. In GitHub → Settings → Secrets and variables → Actions, add:
   - `FLY_API_TOKEN_MARKET` — Fly deploy token scoped to `anchr-market`
     (`flyctl tokens create deploy --name anchr-market`).
   - `FROST_KEY_PASSPHRASE` — generate locally with
     `openssl rand -hex 32` and paste.
2. Actions → **Bootstrap Anchr Market** → Run workflow.

After it succeeds, every future commit to `main` redeploys
automatically via the regular `deploy-market` job. To rotate FROST
keys, re-run the bootstrap workflow with `rotate_keys=true`.

### One-time setup (alternative: local CLI)

```bash
# 1. Create the Fly app + volume.
flyctl apps create anchr-market
flyctl volumes create frost_data --app anchr-market --region nrt --size 1

# 2. Generate the FROST 2-of-3 DKG output, encrypt with a passphrase,
#    and emit the `flyctl secrets set` command.
FROST_KEY_PASSPHRASE=$(openssl rand -hex 32) \
  deno run --allow-all scripts/frost-market-prepare-secrets.ts --app anchr-market

# 3. Run the printed `flyctl secrets set …` command. It uploads the
#    passphrase + 3 base64-encoded encrypted configs as Fly secrets.

# 4. Deploy.
flyctl deploy --remote-only --config fly.market.toml
```

The orchestrator decrypts each `FROST_SIGNER_{1,2,3}_CONFIG_B64` to
`/data/signer-N.json` (mode 0600) on boot, spawns the cluster on
127.0.0.1:4001-4003, then starts the market server.

### Rotating keys

Re-run `frost-market-prepare-secrets.ts` and re-deploy. **Markets
created under the old group pubkeys can no longer be settled** — drain
them first, or pin to a fixed `htlc_hash_yes` / `htlc_hash_no` and use
the HTLC fallback path for those legacy markets.

### Ops checklist

- [x] Public Cashu mint: `https://testnut.cashu.space` (set in `fly.market.toml`).
- [x] Public Nostr relay: `wss://anchr-relay.fly.dev` (the server publishes
      markets as Nostr kind 30078 on creation).
- [x] TLSN verifier proxy: `https://anchr-tlsn-verifier.fly.dev` (browser
      hits it for proof generation; the market server runs the verifier
      *binary* locally to validate submitted presentations).
- [x] FROST 2-of-3 with passphrase-encrypted shares (PR-D).
- [x] TLS via Fly (`force_https = true` in `fly.market.toml`).
- [ ] Add API key or NIP-98 auth middleware in `server.ts`
      (`writeAuth`/`rateLimit`
      currently no-op for the demo). Wire it to your KMS.
- [ ] Run the screenshot script as a smoke test in CI:
      `deno run --allow-all scripts/market-screenshots.ts`.

## 5. Useful smoke tests

```bash
# In-process test of the full lifecycle (skips when mint isn't reachable):
deno test --allow-all e2e/prediction-market-lifecycle.test.ts

# Just the unit + route tests (no Docker needed):
deno task test:example

# Full local run:
deno task test:all
```

## 6. Screenshots

| Step | Screenshot |
|------|------------|
| Empty markets list (default first run) | [`01-empty-markets.png`](./screenshots/01-empty-markets.png) |
| Create-market form | [`02-create-market-form.png`](./screenshots/02-create-market-form.png) |
| Market list with one seeded market | [`03-market-list.png`](./screenshots/03-market-list.png) |
| Market detail + bet panel | [`04-market-detail.png`](./screenshots/04-market-detail.png) |

Re-capture them after UI changes:

```bash
deno task build:ui && deno task build:css
deno run --allow-all scripts/market-screenshots.ts
```

The script boots the market server in-process on port 3098, drives
headless Chromium via Playwright through the empty state and the
create-market form, optionally seeds one demo market, and writes
the screenshots to `docs/prediction-market/screenshots/`.

## 7. Known gaps (pre-1.0)

- The browser-side mint redemption step (combining `oracle_sig` +
  `own_sig` and swapping at the Cashu mint) is documented in
  `MarketDetail.tsx`'s "Settlement" panel but not yet auto-driven by
  the UI. Users currently copy the held cashuB token + the oracle
  signatures out and use a Cashu CLI to redeem. PR-H will close this.
- The auth middleware is a no-op (`noopMiddleware` in `server.ts`).
  Swap in API-key or Nostr-NIP-98 auth before exposing publicly.
- TLSNotary verifier binary must be installed manually. We don't ship
  prebuilt binaries yet.

# Prediction Market Deployment Guide

End-to-end operator runbook for deploying the Anchr prediction market on
**regtest** (local development) or **testnet** (public preview). The
production-style deploy uses encrypted FROST DKG keys (PR-D), the
auto-resolver (PR-B), trustless TLSNotary verification (PR-C), and the
browser-side Cashu bet flow (PR-E).

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
deno run --config deno.json --allow-all example/prediction-market/server.ts
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
deno run --config deno.json --allow-all example/prediction-market/server.ts
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

## 4. Public testnet deploy (checklist)

Beyond the regtest steps:

- [ ] Run a public Cashu mint (e.g. `nutshell` against signet/testnet
      Lightning). Set `CASHU_MINT_URL` to its public URL.
- [ ] Connect to public Nostr relays via `NOSTR_RELAYS`. The server
      auto-publishes new markets as Nostr kind 30078.
- [ ] Provision the FROST cluster across geographically separate
      hosts. Threshold `2-of-3` is the typical sweet spot.
- [ ] Generate the DKG with `FROST_KEY_PASSPHRASE` set; mode-0600
      file permissions are applied automatically.
- [ ] Front the market server with TLS (Caddy, Cloudflare, or your
      reverse proxy of choice). Browser wallets store secret keys in
      localStorage — TLS is mandatory.
- [ ] Add API key middleware in `server.ts` (`writeAuth`/`rateLimit`
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

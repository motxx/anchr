# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Specs: CC0](https://img.shields.io/badge/Specs-CC0-green.svg)](specs/LICENSE)

**Buy cryptographically verified data with sats. No trusted middleman.**

Ask Anchr for the BTC/USD price on CoinGecko and you don't get the
number Anchr *says* CoinGecko returned. You get a TLSNotary proof that
CoinGecko returned that exact number at that exact time — verifiable
without trusting Anchr, the worker who fetched it, or the oracle who
checked it. Payment is in Bitcoin, atomic with verification. The same
shape works for C2PA-stamped photos, GPS-stamped locations, and
ProofMode mobile capture.

The reference server runs in production at
[`anchr-app.fly.dev`](https://anchr-app.fly.dev/health). Specs are CC0.
Anyone can implement an alternative.

## How it works

Three actors. One Bitcoin escrow. One Nostr message bus. Four steps.

```
Requester ─ locks escrow ──► posts query (Nostr DVM)
                                      │
                                      ▼
Worker ─ discovers ────────► produces proof  (TLSNotary / C2PA / ProofMode / GPS)
                                      │
                                      ▼
Oracle ─ verifies cryptographically ──► reveals HTLC preimage  (or FROST t-of-n signs)
                                      │
                                      ▼
Worker ─ redeems token at Cashu Mint ──► Requester gets the verified data

                                                  timeout? ─► escrow refunds
```

1. **Requester** posts a query on Nostr (NIP-90 DVM) and locks payment
   in a Cashu HTLC.
2. **Worker** discovers the query, fetches the data, and produces a
   cryptographic proof — TLSNotary for HTTPS responses, C2PA for photos,
   GPS for location, ProofMode for mobile capture.
3. **Oracle** verifies the proof. If valid, it releases the HTLC
   preimage (or, for high-value queries, t-of-n independent oracles each
   sign via FROST).
4. **Worker** redeems the Cashu token at the mint and the requester
   receives the verified result. If anything fails, the locktime
   refunds the requester.

Three properties hold without any single party being trusted:

- **Requesters can't revoke payment** — sats lock before work begins ([INV-03](docs/threat-model.md#inv-03-requester-cant-unlock-escrow-before-timeout)).
- **Workers can't forge proofs** — verification is cryptographic ([INV-01](docs/threat-model.md#inv-01-worker-cant-forge-tlsn-proofs)).
- **Oracles can't steal funds** — escrow only releases against the worker's signature ([INV-02](docs/threat-model.md#inv-02-oracle-cant-release-preimage-without-valid-proof)).

The full enumeration of invariants and the attack tests that pin them
live in [`docs/threat-model.md`](docs/threat-model.md).

## Built with it

Six runnable applications under [`example/`](example/). Each exists as
real working code that ships in CI — they double as integration tests.

| Example | What it shows |
|---|---|
| **[巫(Kannagi)](example/prediction-market/)** ([live: anchr-market.fly.dev](https://anchr-market.fly.dev)) | Bitcoin-native prediction market. Pool-bet on real-world outcomes (e.g. "Will BTC clear $100k by year-end?") with non-custodial payouts settled by oracle attestation. |
| **[Auto-claim](example/auto-claim/)** | "Install the extension. Browse normally. Money you're owed comes back automatically." |
| **[形代(Katashiro)](example/airdrop-bot-shield/)** | TLSNotary-based Sybil resistance for token airdrops — prove you're human without revealing who you are. |
| **[渡(Watari)](example/tlsn-fiat-swap-square/)** | Trustless fiat ↔ BTC crossing: counterparty proves a Square card payment via TLSNotary; Anchr swaps the proof for BTC. |
| **[C2PA photo verification](example/c2pa-media-verification/)** | News desks pay sats for photos that prove "real camera, real time, real location" via Content Credentials. |
| **[Supply-chain proof](example/supply-chain-proof/)** | GPS + C2PA + ProofMode evidence that a shipment was at a specific location at a specific time. |

## Use it

Three independent paths — pick the one that matches what you're doing.

### As a library

```typescript
import { Anchr } from "anchr-sdk";

const anchr = new Anchr({ serverUrl: "https://anchr-app.fly.dev" });

const result = await anchr.query({
  description: "BTC price from CoinGecko",
  targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
  maxSats: 21,
});

console.log(result.verified);   // true
console.log(result.data);       // { bitcoin: { usd: 71000 } }
console.log(result.serverName); // "api.coingecko.com" (cryptographically verified)
console.log(result.proof);      // base64 TLSNotary presentation, independently verifiable
```

Install: `bun add anchr-sdk` (or `npm i anchr-sdk`).

### As a server

```bash
deno install
deno task build:ui && deno task build:css
deno task dev                        # http://localhost:3000
```

With Bitcoin regtest + Cashu mint + Nostr relay + Blossom storage in
Docker:

```bash
docker compose up -d && sleep 25 && ./scripts/init-regtest.sh
deno task test:regtest               # full E2E against regtest
```

The [`/test-regtest`](.claude/skills/test-regtest/SKILL.md) and
[`/test-tlsn`](.claude/skills/test-tlsn/SKILL.md) runbooks document the
deep local-CI flow.

### As a contributor

```bash
deno task lint:strict          # deno lint + arch + invariants + paths + types
deno task test:unit            # 217 unit tests
deno task test:packages        # 71 per-package tests, each in isolation
deno task test:protocol        # protocol invariants (trustless / attacks / quorum)
deno task test:frost           # FROST threshold signing
deno task test:regtest         # full Cashu + Lightning E2E (Docker)
deno task test:pentest         # penetration tests
deno task test:example         # all example apps
./scripts/test-all.sh --local  # what CI runs in Phase 1
```

The CI quality bar (full detail in [`CLAUDE.md`](CLAUDE.md)):

- Full TypeScript strict; no `--no-check` anywhere in test tasks.
- No `as` casts or `any` in `src/` or `packages/`. `unknown` only at
  HTTP/JSON boundaries, with a `// type-lint-allow:` reason.
- Architecture lint enforces a single shared root (`core-runtime`); no
  other inter-package dependencies.
- Every threat-model invariant must have a test
  (`deno task lint:invariants`).
- `console.*` in non-UI code routes through logTape via
  `@anchr/core-runtime/logger`.

## Inside

Anchr is seven independently typecheckable packages on top of a Hono /
Deno reference server. No package depends on host-side code, so any
piece can be lifted out and used on its own (`deno task test:packages`
runs each one in isolation).

```
packages/
├── core-runtime/              Bun ↔ Deno runtime helpers (spawn, fs, which, logger, env)
├── core-cashu/                Cashu HTLC escrow + preimage store
├── tlsn-toolkit/              TLSNotary application layer (validation, replay defence, ReDoS guard)
├── photo-bounty/              C2PA + EXIF + ProofMode + AI content check + GPS Haversine
├── cashu-frost-oracle/        FROST t-of-n cluster wrapper for Cashu P2PK threshold signing
├── cashu-conditional-swap/    N:M binary-outcome conditional swap primitive (HTLC / FROST dual-key)
└── sdk/                       anchr-sdk: HTTP / MCP client for AI agents

src/                           Reference host server (Hono on Deno) — composes the packages above
example/                       Runnable examples; each has its own `deno.json`
crates/                        Rust: frost-signer, tlsn-prover, tlsn-server, tlsn-verifier
specs/                         Wire-format specs (CC0)
docs/                          Host implementation guides + threat-model invariants
```

The current state of each surface:

| Surface | State |
|---|---|
| Cashu HTLC payment + escrow | Implemented, fuzzed (`e2e/regtest-htlc-attacks.test.ts`) |
| TLSNotary proof verification | Implemented (replay-protected, ReDoS-safe conditions) |
| FROST t-of-n threshold oracles | Implemented (`crates/frost-signer`, BIP-340 Schnorr) |
| C2PA / ProofMode / GPS / EXIF | Implemented |
| Nostr DVM (NIP-90) discovery | Implemented |
| Blossom (NIP-44 + AES-256-GCM) | Implemented |

Active development. Baseline tests are green and threat-model
invariants are tracked. API stability is not yet guaranteed — pin
versions and watch the changelog if you depend on the SDK or HTTP API.

## Reference

<details>
<summary>HTTP API — query / oracle endpoints</summary>

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/queries` | Create query |
| `GET` | `/queries` | List open queries |
| `GET` | `/queries/:id` | Query detail |
| `POST` | `/queries/:id/quotes` | Worker submits quote |
| `POST` | `/queries/:id/select` | Select Worker |
| `POST` | `/queries/:id/begin` | Worker begins work |
| `POST` | `/queries/:id/result` | Submit proof + verify + settle |
| `POST` | `/queries/:id/cancel` | Cancel query |
| `POST` | `/queries/:id/upload` | Upload media (auth required) |
| `GET` | `/queries/:id/attachments` | List attachments |
| `POST` | `/hash` | Oracle generates preimage / hash |
| `GET` | `/oracles` | List oracles |
| `GET` | `/health` | Health check |

</details>

<details>
<summary>HTTP API — marketplace endpoints</summary>

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/marketplace/listings` | List active data listings |
| `POST` | `/marketplace/listings` | Create listing (auth required) |
| `GET` | `/marketplace/data/:id` | Purchase info (HTTP 402) |
| `POST` | `/marketplace/data/:id` | Buy data (X-Cashu / X-Cashu-Htlc) |

</details>

<details>
<summary>Configuration (env)</summary>

| Variable | Default |
|---|---|
| `PORT` / `REFERENCE_APP_PORT` | `3000` |
| `HTTP_API_KEYS` (comma-separated) | — |
| `CASHU_MINT_URL` | — |
| `NOSTR_RELAYS` | — |
| `BLOSSOM_SERVERS` | — |
| `TLSN_VERIFIER_URL` / `TLSN_PROXY_URL` | — |
| `FROST_CONFIG_PATH` | — |
| `TRUSTED_ORACLE_PUBKEYS` | — |
| `ANTHROPIC_API_KEY` (for AI content check) | — |
| `ANCHR_LOG_LEVEL` (`debug`/`info`/`warning`/`error`) | `info` |
| `RUNTIME_DATA_DIR` | `.local` |

</details>

## Contributing & License

Issues and PRs welcome. Run `./scripts/test-all.sh --local` before
pushing; CI gates the quality bar above plus `test:all:docker` for the
relay + regtest phases.

Code: [MIT](LICENSE) · Specs: [CC0](specs/LICENSE) — anyone may
implement them.

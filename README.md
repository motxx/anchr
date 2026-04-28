# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Specs: CC0](https://img.shields.io/badge/Specs-CC0-green.svg)](specs/LICENSE)

**Buy cryptographically verified data with sats. No trusted middleman.**

Anchr is a TypeScript / Deno toolkit and reference server for atomic
exchanges of *cryptographic proofs* (TLSNotary for HTTPS responses, C2PA
for photos, GPS for location, ProofMode for mobile capture) and *Bitcoin
payments* (Cashu HTLC, optionally backed by FROST t-of-n threshold
oracles).

Three properties hold without a trusted middleman:

- **Requesters can't revoke payment** — sats lock in escrow before work begins ([INV-03](docs/threat-model.md#inv-03-requester-cant-unlock-escrow-before-timeout)).
- **Workers can't forge proofs** — verification is cryptographic ([INV-01](docs/threat-model.md#inv-01-worker-cant-forge-tlsn-proofs)).
- **Oracles can't steal funds** — escrow only releases against the worker's signature ([INV-02](docs/threat-model.md#inv-02-oracle-cant-release-preimage-without-valid-proof)).

For high-value queries, t-of-n independent oracles can verify in parallel
via FROST; below threshold, no party can produce a valid release signature.

## Examples

Each example is runnable code under [`example/`](example/) — they double as
integration tests and run in CI.

| Example | What it shows |
|---|---|
| **[巫(Kannagi)](example/prediction-market/)** ([live: anchr-market.fly.dev](https://anchr-market.fly.dev)) | Bitcoin-native prediction market. Pool-bet on real-world outcomes (e.g. "Will BTC clear $100k by year-end?") with non-custodial payouts settled by oracle attestation. |
| **[Auto-claim](example/auto-claim/)** | "Install the extension. Browse normally. Money you're owed comes back automatically." |
| **[形代(Katashiro)](example/airdrop-bot-shield/)** | TLSNotary-based Sybil resistance for token airdrops — prove you're human without revealing who you are. |
| **[渡(Watari)](example/tlsn-fiat-swap-square/)** | Trustless fiat ↔ BTC crossing: counterparty proves a Square card payment via TLSNotary; Anchr swaps the proof for BTC. |
| **[C2PA photo verification](example/c2pa-media-verification/)** | News desks pay sats for photos that prove "real camera, real time, real location" via Content Credentials. |
| **[Supply-chain proof](example/supply-chain-proof/)** | GPS + C2PA + ProofMode evidence that a shipment was at a specific location at a specific time. |

## How it works

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

Wire-format specs needed for an alternative implementation live in
[`specs/`](specs/) (CC0): Nostr DVM messaging, conditional-swap primitive,
oracle registry. Per-package implementation guides live in each package's
`SPEC.md` (e.g. [`packages/core-cashu/SPEC.md`](packages/core-cashu/SPEC.md),
[`packages/tlsn-toolkit/SPEC.md`](packages/tlsn-toolkit/SPEC.md)).

## Quick start

Pick a path. Each is independent — you don't need the others.

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

With Bitcoin regtest + Cashu mint + Nostr relay + Blossom storage in Docker:

```bash
docker compose up -d && sleep 25 && ./scripts/init-regtest.sh
deno task test:regtest               # full E2E against regtest
```

See the [`/test-regtest`](.claude/skills/test-regtest/SKILL.md) and
[`/test-tlsn`](.claude/skills/test-tlsn/SKILL.md) runbooks for the deep
local-CI flow.

### As a contributor

```bash
deno task lint:strict          # deno lint + arch + invariants + paths + types
deno task test:unit            # 217 unit tests
deno task test:packages        # 71 per-package tests, each in isolation
deno task test:protocol        # protocol-level invariants (trustless / attacks / exploits / quorum)
deno task test:frost           # FROST threshold signing
deno task test:regtest         # full Cashu + Lightning E2E (Docker)
deno task test:pentest         # penetration tests
deno task test:example         # all 7 example apps
./scripts/test-all.sh --local  # what CI runs in Phase 1
```

Quality bar (enforced by CI — see [`CLAUDE.md`](CLAUDE.md)):

- No `--no-check` in test tasks; full TypeScript strict.
- No `as` casts or `any` in `src/` or `packages/`. `unknown` only at HTTP/JSON
  boundaries with a `// type-lint-allow:` reason.
- Architecture lint enforces a single shared root (`core-runtime`); no other
  inter-package dependencies (`deno task lint:arch`).
- Threat-model invariants must each have a test (`deno task lint:invariants`).
- `console.*` in non-UI code routes through logTape via
  `@anchr/core-runtime/logger`.

## Architecture

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
example/                       Worked, runnable examples; each is its own `deno.json`
crates/                        Rust: frost-signer, tlsn-prover, tlsn-server, tlsn-verifier
specs/                         Wire-format specs (CC0): Nostr DVM, conditional swap, oracle registry
docs/                          Host implementation guides (lifecycle, storage) + threat-model invariants
```

Each `packages/*` is independently typecheckable and testable
(`deno task test:packages`). No package depends on host-side code.

## Project state

**Active development. Baseline tests are green and threat-model invariants
are tracked.** The reference server runs in production at
[`anchr-app.fly.dev`](https://anchr-app.fly.dev/health). API stability is
not guaranteed yet — pin versions and follow the changelog if you depend
on the SDK or HTTP API.

| Surface | State |
|---|---|
| Cashu HTLC payment + escrow | Implemented, fuzzed (`e2e/regtest-htlc-attacks.test.ts`) |
| TLSNotary proof verification | Implemented (replay-protected, ReDoS-safe conditions) |
| FROST t-of-n threshold oracles | Implemented (`crates/frost-signer`, BIP-340 Schnorr) |
| C2PA / ProofMode / GPS / EXIF | Implemented |
| Nostr DVM (NIP-90) discovery | Implemented |
| Blossom (NIP-44 + AES-256-GCM) | Implemented |

Full enumeration with attack tests in [`docs/threat-model.md`](docs/threat-model.md).

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

Issues and PRs welcome. Run `./scripts/test-all.sh --local` before pushing;
the CI gate enforces the quality bar above plus `test:all:docker` for the
relay + regtest phases.

Code: [MIT](LICENSE) · Specs: [CC0](specs/LICENSE) (anyone may implement them).
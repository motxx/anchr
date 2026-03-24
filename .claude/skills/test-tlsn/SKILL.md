---
name: test-tlsn
description: TLSNotary verification E2E test with real cryptographic proofs. Three worker modes — CLI/TCP, CLI/WebSocket, Browser Extension. Requires Docker (Verifier Server) and Rust toolchain.
disable-model-invocation: false
argument-hint: "[full|build|infra|tcp|ws|browser|anchr|teardown]"
---

# TLSNotary E2E Test Runbook

Test the full TLSNotary flow with **real cryptographic proofs** across all three worker modes.

## Architecture

```
┌──────────────────┐   TCP    ┌──────────────────────────────┐
│ CLI Worker        │◄────────►│ Verifier Server (Docker)     │
│ (tlsn-prove)      │   WS    │ TCP  :7047 — CLI prover      │
│                   │◄────────►│ HTTP :7048 — /health, /info  │
└────────┬─────────┘          │ WS   :7048 — /session        │
         │                     │              /verifier        │
         │ .presentation.tlsn  │              /proxy           │
         ▼                     └──────────────────────────────┘
┌──────────────────┐
│ Anchr API (:3000) │ → tlsn-verifier binary → verify → pass/fail
└──────────────────┘

┌──────────────────┐   WS    ┌──────────────────────────────┐
│ Browser Extension │◄────────►│ Same Verifier Server         │
│ (Chrome)          │         │ /session + /verifier + /proxy │
└──────────────────┘          └──────────────────────────────┘
```

## Quick start

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
cd "$PROJECT_ROOT"
```

**Automated E2E (no browser):**
```bash
cd crates/tlsn-prover && cargo build && cd ../tlsn-verifier && cargo build --release && cd "$PROJECT_ROOT"
docker compose up tlsn-verifier -d
bun run src/index.ts &
until curl -sf http://localhost:3000/health >/dev/null 2>&1; do :; done
bun test e2e/tlsn.test.ts
docker compose down tlsn-verifier
pkill -f "bun.*src/index.ts"
```

---

## Phase 1: Build (`build`)

```bash
cd "$PROJECT_ROOT"
cd crates/tlsn-prover && cargo build
cd ../tlsn-verifier && cargo build --release
cd ../tlsn-server && cargo build
cd "$PROJECT_ROOT"
```

**Verify:**
```bash
crates/tlsn-prover/target/debug/tlsn-prove --help
crates/tlsn-verifier/target/release/tlsn-verifier --help
crates/tlsn-server/target/debug/tlsn-server --help
```

---

## Phase 2: Infrastructure (`infra`)

### Option A: Docker Verifier (TCP only, port 7047)
```bash
docker compose up tlsn-verifier -d
docker compose ps tlsn-verifier
```

### Option B: Local Verifier (dual protocol, TCP 7047 + WS 7048)
```bash
crates/tlsn-server/target/debug/tlsn-server --tcp-port 7047 --ws-port 7048 &
```

### Start Anchr server
```bash
bun run src/index.ts &
until curl -sf http://localhost:3000/health >/dev/null 2>&1; do :; done
```

**Verify:**
```bash
curl -s http://localhost:7048/health   # "ok" (WS server)
curl -s http://localhost:7048/info     # version info
curl -s http://localhost:3000/health   # Anchr server
```

---

## Phase 3: CLI Worker — TCP mode (`tcp`)

```bash
crates/tlsn-prover/target/debug/tlsn-prove \
  --verifier localhost:7047 \
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" \
  -o /tmp/btc-tcp.presentation.tlsn

crates/tlsn-verifier/target/release/tlsn-verifier verify /tmp/btc-tcp.presentation.tlsn | jq '{valid, server_name, revealed_body}'
```

**Expected:** `valid: true`, `server_name: "api.coingecko.com"`, `revealed_body: {"bitcoin":{"usd":XXXXX}}`

---

## Phase 4: CLI Worker — WebSocket mode (`ws`)

Requires local Verifier (Option B from Phase 2).

```bash
crates/tlsn-prover/target/debug/tlsn-prove \
  --verifier ws://localhost:7048 \
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" \
  -o /tmp/btc-ws.presentation.tlsn

crates/tlsn-verifier/target/release/tlsn-verifier verify /tmp/btc-ws.presentation.tlsn | jq '{valid, server_name, revealed_body}'
```

**Expected:** Same as TCP mode.

---

## Phase 5: Browser Extension (`browser`)

### 5a. Install TLSNotary Extension

Chrome Web Store: https://chromewebstore.google.com/detail/tlsnotary/gnoglgpcamodhflknhmafmjdahcejcgg

### 5b. Start local Verifier with WS+proxy

```bash
crates/tlsn-server/target/debug/tlsn-server --tcp-port 7047 --ws-port 7048 &
```

Endpoints available:
- `ws://localhost:7048/session` — session registration
- `ws://localhost:7048/verifier?sessionId=<id>` — MPC-TLS
- `ws://localhost:7048/proxy?token=<hostname>` — WS-to-TCP proxy

### 5c. Run plugin

Open extension DevConsole and paste the plugin from `tools/tlsn-plugin/coingecko-btc.js`:

```javascript
const VERIFIER_URL = 'ws://localhost:7048';
const PROXY_URL = 'ws://localhost:7048/proxy?token=api.coingecko.com';
```

### 5d. Expected flow
1. Extension registers session via `/session`
2. MPC-TLS runs via `/verifier` + `/proxy`
3. Server returns `session_completed` with verified data
4. Extension displays proof results

---

## Phase 6: Anchr API submission (`anchr`)

Submit any generated presentation to Anchr:

```bash
PRESENTATION_B64=$(base64 -i /tmp/btc-tcp.presentation.tlsn | tr -d '\n')

QID=$(curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{"description":"BTC price","verification_requirements":["tlsn"],"tlsn_requirements":{"target_url":"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd","conditions":[{"type":"jsonpath","expression":"bitcoin.usd","description":"BTC price exists"}]},"bounty":{"amount_sats":21},"ttl_seconds":600}' | jq -r '.query_id')

python3 -c "import json; print(json.dumps({'tlsn_presentation': open('/dev/stdin').read().strip()}))" <<< "$PRESENTATION_B64" > /tmp/submit.json

curl -s -X POST "http://localhost:3000/queries/${QID}/submit" \
  -H "Content-Type: application/json" \
  -d @/tmp/submit.json | jq '{ok, verification}'
```

**Expected:** `ok: true`, all 4 checks pass (signature, domain, freshness, condition).

---

## Phase 7: Teardown (`teardown`)

```bash
pkill -f "bun.*src/index.ts" 2>/dev/null || true
pkill -f "tlsn-server" 2>/dev/null || true
docker compose down tlsn-verifier 2>/dev/null || true
```

---

## Automated Tests

```bash
bun test src/verification/tlsn-validation.test.ts   # 18 unit tests
bun test e2e/tlsn.test.ts                           # 4 E2E tests (requires infra)
```

---

## Worker Modes Summary

| Mode | Transport | Proxy | Attestation | Status |
|------|-----------|-------|-------------|--------|
| CLI/TCP | TCP :7047 | Not needed | Server → Prover (direct) | **Working** |
| CLI/WS | WS :7048 | Not needed (direct TCP) | Server → Prover (via session_completed) | **Working** |
| Browser Extension | WS :7048 | Required (/proxy) | Server → Extension (via session_completed) | **Server ready** |

## Checklist

| Step | Expected |
|------|----------|
| `cargo build` all crates | 3 binaries built |
| Docker Verifier Server | Running on :7047 |
| Local Verifier Server | Running on :7047 + :7048 |
| TCP prover → presentation | ~5KB file, valid |
| WS prover → presentation | ~5KB file, valid |
| Anchr submit → verification | passed: true, 4 checks |
| /health endpoint | "ok" |
| /info endpoint | version + tlsn_version |
| /proxy endpoint | WS-to-TCP bridge working |

## Port Reference

| Service | Port |
|---------|------|
| Verifier Server (TCP) | 7047 |
| Verifier Server (HTTP/WS) | 7048 |
| Anchr Server | 3000 |
| Nostr Relay | 7777 |
| Blossom | 3333 |
| Metro Bundler | 8082 |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Prover binary not found | `cd crates/tlsn-prover && cargo build` |
| Verifier binary not found | `cd crates/tlsn-verifier && cargo build --release` |
| Server binary not found | `cd crates/tlsn-server && cargo build` |
| Docker build fails | Use `rust:1-bookworm` image (edition 2024 needs Rust 1.85+) |
| MPC connection timeout | Check Verifier Server is running on correct port |
| "binary not available" | `tlsn-verifier` must be in PATH or `crates/tlsn-verifier/target/release/` |
| Freshness check fails | Submit within 300s of generation |
| Chunked body condition fail | Update `tlsn-verifier` (chunked decoding added) |
| WS session "error" | Check server logs for MPC failure details |
| Browser extension "proxy error" | Ensure `/proxy` endpoint is accessible on WS port |

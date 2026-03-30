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

### 5a. Build extension from source (first time only)

The extension needs a 1-line fix for HTTP request URI format.
See: https://github.com/tlsnotary/tlsn-extension/pull/268

```bash
cd /tmp
git clone https://github.com/motxx/tlsn-extension.git  # fork with fix
cd tlsn-extension
git checkout fix/prove-manager-uri-absolute-form
npm install
```

Modify the default DevConsole template in
`packages/extension/src/entries/DevConsole/index.tsx`:

Replace the default `X Profile Prover` template with:

```javascript
const VERIFIER_URL = 'http://localhost:7047';
const PROXY_URL = 'ws://localhost:7047/proxy?token=httpbin.org';

export default {
  config: {
    name: 'Anchr: httpbin.org Test',
    description: 'Prove HTTP response from httpbin.org via Anchr Verifier',
    requests: [{
      method: 'GET',
      host: 'httpbin.org',
      pathname: '/**',
      verifierUrl: VERIFIER_URL,
    }],
  },
  main: async () => {
    const proof = await prove(
      {
        url: 'https://httpbin.org/get',
        method: 'GET',
        headers: {
          'Host': 'httpbin.org',
          'Accept': 'application/json',
          'Accept-Encoding': 'identity',
          'Connection': 'close',
        },
      },
      {
        verifierUrl: VERIFIER_URL,
        proxyUrl: PROXY_URL,
        maxRecvData: 16384,
        maxSentData: 4096,
        handlers: [
          { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
          { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' },
          { type: 'RECV', part: 'BODY', action: 'REVEAL' },
        ],
      }
    );
    done(proof);
  },
};
```

Build:
```bash
npm run build
```

### 5b. Start Verifier Server

```bash
cd "$PROJECT_ROOT"
crates/tlsn-server/target/debug/tlsn-server --tcp-port 7046 --ws-port 7047 &
```

Endpoints:
- `ws://localhost:7047/session` — session registration
- `ws://localhost:7047/verifier?sessionId=<id>` — MPC-TLS (WsStream)
- `ws://localhost:7047/proxy?token=<hostname>` — WS-to-TCP bridge

### 5c. Automated test

```bash
bun test e2e/tlsn-browser.test.ts
```

This launches Chrome for Testing with the built extension, opens DevConsole,
auto-approves the confirmPopup, runs the plugin, and verifies:
- Status code: 200
- Response body contains httpbin.org JSON
- Execution completes within 120s

### 5d. Manual test

```bash
# Launch Chrome for Testing with extension
CHROMIUM=~/.cache/puppeteer/chrome/*/chrome-mac-arm64/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing
EXT=/tmp/tlsn-extension/packages/extension/build
"$CHROMIUM" --no-first-run --disable-extensions-except="$EXT" --load-extension="$EXT"
```

1. Navigate to `chrome-extension://<ext-id>/devConsole.html`
2. Click **Run Code**
3. Click **Allow** on the confirmPopup
4. Wait ~10s for MPC-TLS
5. Result appears in Console:

```json
{
  "results": [
    { "type": "SENT", "part": "START_LINE", "value": "GET /get HTTP/1.1\r\n" },
    { "type": "RECV", "part": "STATUS_CODE", "value": "200" },
    { "type": "RECV", "part": "BODY", "value": "{\"args\":{},\"headers\":{...},\"url\":\"https://httpbin.org/get\"}" }
  ]
}
```

### 5e. Key findings

- Extension's WASM prover sends HTTP requests through MPC-TLS, not the proxy
- Proxy is only for the raw TLS connection (TCP bridge)
- Plugin must include `Host` header explicitly
- Plugin must call `done(proof)` instead of `return proof` for DevConsole to show results
- URI fix (PR #268) required: full URL → path-only in request line

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

## Phase 8: Deploy to fly.io (`deploy`)

### Prerequisites
- `fly` CLI installed and authenticated
- fly.io apps created: `anchr-app`, `anchr-tlsn-verifier`, `anchr-tlsn-worker`

### Deploy all services
```bash
./scripts/deploy.sh all
```

### Deploy individually
```bash
./scripts/deploy.sh verifier   # TLSNotary Verifier Server
./scripts/deploy.sh app        # Anchr App (Oracle + API)
./scripts/deploy.sh worker     # Auto-Worker daemon
```

### Verify production
```bash
curl -s https://anchr-app.fly.dev/health | jq .
curl -s https://anchr-tlsn-verifier.fly.dev/health
```

### Production E2E test
```bash
# Create query on production
QID=$(curl -s -X POST https://anchr-app.fly.dev/queries \
  -H "Content-Type: application/json" \
  -d '{"description":"BTC price","verification_requirements":["tlsn"],"tlsn_requirements":{"target_url":"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd","conditions":[{"type":"jsonpath","expression":"bitcoin.usd"}]},"bounty":{"amount_sats":21},"ttl_seconds":600}' | jq -r '.query_id')
echo "Created: $QID"

# Check query status (Auto-Worker should fulfill it)
curl -s "https://anchr-app.fly.dev/queries/$QID" | jq '{status, verification_requirements}'
```

### Production URLs
| Service | URL |
|---------|-----|
| Anchr App | https://anchr-app.fly.dev |
| Verifier Server | https://anchr-tlsn-verifier.fly.dev |
| Requester UI | https://anchr-app.fly.dev/requester |

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

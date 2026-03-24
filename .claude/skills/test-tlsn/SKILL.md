---
name: test-tlsn
description: TLSNotary verification E2E test with real cryptographic proofs. Generates a TLSNotary presentation via MPC-TLS, submits to Anchr, and verifies. Requires Docker (Verifier Server) and Rust toolchain (prover/verifier binaries).
disable-model-invocation: false
argument-hint: "[full|build|infra|query|mobile|requester|teardown]"
---

# TLSNotary E2E Test Runbook

Test the full TLSNotary flow with **real cryptographic proofs**: Docker Verifier Server → MPC-TLS Prover → Anchr API verification → mobile/web UI.

## Quick start

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
cd "$PROJECT_ROOT"
```

**Automated (no UI):**
```bash
# 1. Build Rust binaries
cd crates/tlsn-prover && cargo build && cd ../tlsn-verifier && cargo build --release && cd "$PROJECT_ROOT"

# 2. Start Verifier Server + Anchr
docker compose up tlsn-verifier -d
bun run src/index.ts &
until curl -sf http://localhost:3000/health >/dev/null 2>&1; do :; done

# 3. Run E2E tests
bun test e2e/tlsn.test.ts

# 4. Teardown
docker compose down tlsn-verifier
pkill -f "bun.*src/index.ts"
```

**Full runbook (includes mobile):** Use `/test-tlsn full` and follow all phases below.

---

Phases: `full` (default) | `build` | `infra` | `query` | `mobile` | `requester` | `teardown`

---

## Phase 1: Build (`build`)

Build the Rust binaries (first time or after code changes).

```bash
cd "$PROJECT_ROOT"

# Prover (generates presentations)
cd crates/tlsn-prover && cargo build
# Verifier (cryptographic verification)
cd ../tlsn-verifier && cargo build --release
cd "$PROJECT_ROOT"
```

**Verification:**
```bash
crates/tlsn-prover/target/debug/tlsn-prove --help
crates/tlsn-verifier/target/release/tlsn-verifier --help
```

---

## Phase 2: Infrastructure (`infra`)

Start Docker Verifier Server and Anchr server.

```bash
cd "$PROJECT_ROOT"

# Start Verifier Server (Docker)
docker compose up tlsn-verifier -d

# Start Anchr server
pkill -f "bun.*src/index.ts" 2>/dev/null || true
bun run src/index.ts &
until curl -sf http://localhost:3000/health >/dev/null 2>&1; do :; done
```

**Verification:**
```bash
docker compose ps tlsn-verifier
# Expected: STATUS = Up, PORT = 0.0.0.0:7047->7047/tcp

curl -s http://localhost:3000/health | jq .
# Expected: {"ok": true}
```

---

## Phase 3: Query + Real Presentation (`query`)

### 3a. Generate a real TLSNotary presentation

```bash
cd "$PROJECT_ROOT"

# Prover connects to Docker Verifier via MPC-TLS, fetches CoinGecko, outputs presentation
crates/tlsn-prover/target/debug/tlsn-prove \
  --verifier localhost:7047 \
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" \
  -o /tmp/btc.presentation.tlsn
```

**Expected output:**
```
[tlsn-prove] MPC connection established
[tlsn-prove] Connected to api.coingecko.com:443
[tlsn-prove] Response status: 200 OK
[tlsn-prove] Attestation received and validated
[tlsn-prove] Presentation saved to /tmp/btc.presentation.tlsn
[tlsn-prove] Size: ~5000 bytes
```

### 3b. Verify the presentation independently

```bash
crates/tlsn-verifier/target/release/tlsn-verifier verify /tmp/btc.presentation.tlsn | jq .
```

**Expected:**
```json
{
  "valid": true,
  "server_name": "api.coingecko.com",
  "revealed_body": "{\"bitcoin\":{\"usd\":XXXXX}}",
  "time": 17XXXXXXXX
}
```

### 3c. Create Anchr query and submit real presentation

```bash
QUERY_ID=$(curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Verify BTC price on CoinGecko",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": {
      "target_url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      "conditions": [{ "type": "jsonpath", "expression": "bitcoin.usd", "description": "BTC price exists" }]
    },
    "bounty": { "amount_sats": 21 },
    "ttl_seconds": 600
  }' | jq -r '.query_id')
echo "Query: $QUERY_ID"

# Submit the real presentation (base64 on stdout from tlsn-prove)
PRESENTATION_B64=$(base64 -i /tmp/btc.presentation.tlsn | tr -d '\n')
python3 -c "import json; print(json.dumps({'tlsn_presentation': open('/dev/stdin').read().strip()}))" <<< "$PRESENTATION_B64" > /tmp/submit.json

curl -s -X POST "http://localhost:3000/queries/${QUERY_ID}/submit" \
  -H "Content-Type: application/json" \
  -d @/tmp/submit.json | jq .
```

**Expected:**
```json
{
  "ok": true,
  "message": "Verification passed. Result accepted.",
  "verification": {
    "passed": true,
    "checks": [
      "TLSNotary: presentation signature valid (cryptographically verified)",
      "TLSNotary: server name matches target (api.coingecko.com)",
      "TLSNotary: attestation fresh (Xs old, max 300s)",
      "TLSNotary condition passed: BTC price exists"
    ],
    "failures": []
  }
}
```

### 3d. Verify failure cases

```bash
# Missing presentation → fail
FAIL_QID=$(curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{"description":"fail test","verification_requirements":["tlsn"],"tlsn_requirements":{"target_url":"https://example.com"},"ttl_seconds":120}' | jq -r '.query_id')
curl -s -X POST "http://localhost:3000/queries/${FAIL_QID}/submit" \
  -H "Content-Type: application/json" -d '{}' | jq '{ok, message}'
# Expected: ok=false, "no attestation provided"

# Invalid presentation data → fail
FAIL_QID2=$(curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{"description":"fail test 2","verification_requirements":["tlsn"],"tlsn_requirements":{"target_url":"https://example.com"},"ttl_seconds":120}' | jq -r '.query_id')
curl -s -X POST "http://localhost:3000/queries/${FAIL_QID2}/submit" \
  -H "Content-Type: application/json" -d '{"tlsn_presentation":"dGVzdA=="}' | jq '{ok, message}'
# Expected: ok=false, "presentation signature invalid"
```

### 3e. Run automated E2E tests

```bash
bun test e2e/tlsn.test.ts
```

---

## Phase 4: Mobile App Test (`mobile`)

### 4a. Start Metro bundler

```bash
cd "$PROJECT_ROOT/mobile"
bun install
bunx expo start --port 8082 &
```

### 4b. Open app

```bash
xcrun simctl openurl booted "exp://192.168.10.101:8082"
```

### 4c. Create pending query, open in app, submit presentation, verify UI

```bash
cd "$PROJECT_ROOT"

# Create query
MOBILE_QID=$(curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Verify ETH price on CoinGecko",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": {
      "target_url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      "conditions": [{ "type": "jsonpath", "expression": "ethereum.usd", "description": "ETH price exists" }]
    },
    "bounty": { "amount_sats": 15 },
    "ttl_seconds": 600
  }' | jq -r '.query_id')
```

1. Open the query in the mobile app — should show **"TLSNotary Verification Required"** (not Camera/Import)
2. Generate and submit presentation:

```bash
crates/tlsn-prover/target/debug/tlsn-prove \
  --verifier localhost:7047 \
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd" \
  -o /tmp/eth.presentation.tlsn

PRESENTATION_B64=$(base64 -i /tmp/eth.presentation.tlsn | tr -d '\n')
python3 -c "import json; print(json.dumps({'tlsn_presentation': open('/dev/stdin').read().strip()}))" <<< "$PRESENTATION_B64" > /tmp/eth-submit.json
curl -s -X POST "http://localhost:3000/queries/${MOBILE_QID}/submit" \
  -H "Content-Type: application/json" -d @/tmp/eth-submit.json | jq '{ok}'
```

3. Wait ~7s for poll, verify on mobile:
   - **Approved** status
   - **VERIFICATION**: "cryptographically verified", "server name matches", "ETH price exists"
   - **TLSNOTARY PROOF (cryptographically verified)**: server name, conditions, Server Response (JSON)

---

## Phase 5: Requester Web UI (`requester`)

Open `http://localhost:3000/requester` in browser or gstack browse.

1. Click query card to expand
2. Verify: 承認 + 検証OK + TLSNotary Proof panel with server response

---

## Phase 6: Teardown (`teardown`)

```bash
pkill -f "bun.*src/index.ts" 2>/dev/null || true
pkill -f "expo start" 2>/dev/null || true
docker compose down tlsn-verifier
```

---

## Unit Tests

```bash
bun test src/verification/tlsn-validation.test.ts
# 18 tests: condition evaluation, binary-unavailable failure, mock binary tests, verify() integration
```

---

## Checklist

| Step | Expected |
|------|----------|
| `cargo build` (prover + verifier) | Binaries built |
| `docker compose up tlsn-verifier` | Container running on :7047 |
| `tlsn-prove --verifier localhost:7047 <url>` | Presentation file generated (~5KB) |
| `tlsn-verifier verify <file>` | `valid: true`, server_name + revealed_body extracted |
| `POST /queries` with `tlsn` | Query created with `tlsn_requirements` |
| Submit real presentation | `verification.passed: true`, 4 checks all pass |
| Submit without presentation | Fails: "no attestation provided" |
| Submit invalid data | Fails: "signature invalid" |
| `bun test e2e/tlsn.test.ts` | All tests pass |
| Mobile: pending tlsn query | Shows "TLSNotary Verification Required" (no Camera/Import) |
| Mobile: after submit | VERIFICATION + TLSNOTARY PROOF sections |
| Requester: expanded card | 検証OK + TLSNotary Proof panel |

## Architecture

```
┌─────────────────┐     MPC-TLS     ┌──────────────────────┐
│  tlsn-prove     │◄───────────────►│  tlsn-server         │
│  (Prover CLI)   │                 │  (Docker :7047)      │
└────────┬────────┘                 └──────────────────────┘
         │ .presentation.tlsn (base64)
         ▼
┌─────────────────┐     verify      ┌──────────────────────┐
│  Anchr API      │────────────────►│  tlsn-verifier       │
│  (:3000)        │                 │  (sidecar binary)    │
└────────┬────────┘                 └──────────────────────┘
         │ conditions + verified data
         ▼
   pass/fail → bounty released
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `tlsn-prove` binary not found | `cd crates/tlsn-prover && cargo build` |
| `tlsn-verifier` binary not found | `cd crates/tlsn-verifier && cargo build --release` |
| Docker Verifier not starting | `docker compose build tlsn-verifier` (Rust build in Docker) |
| MPC connection failed | Verify Verifier Server is running: `docker compose ps tlsn-verifier` |
| "binary not available" in verification | Ensure `tlsn-verifier` is in PATH or `crates/tlsn-verifier/target/release/` |
| Condition "jsonpath" fails | Check chunked body decoding: `tlsn-verifier verify <file> \| jq .revealed_body` |
| Freshness check fails | Presentation must be submitted within 300s of generation |
| Metro cache stale | Restart: `bunx expo start --port 8082 --clear` |

## Port Reference

| Service | Port |
|---------|------|
| Anchr Server | 3000 |
| TLSNotary Verifier Server | 7047 |
| Nostr Relay | 7777 |
| Blossom | 3333 |
| Metro Bundler | 8082 |

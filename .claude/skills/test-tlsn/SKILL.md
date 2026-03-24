---
name: test-tlsn
description: TLSNotary verification E2E test. Creates a TLSNotary query, submits an attestation, and verifies proof display on mobile (iOS Simulator) and Requester web UI. Use when testing the TLSNotary web content verification flow.
disable-model-invocation: false
argument-hint: "[full|server|query|mobile|requester|teardown]"
---

# TLSNotary E2E Test Runbook

Test the TLSNotary web content verification flow end-to-end: server + query creation + attestation submission + mobile Worker app + Requester web UI.

## Quick start

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

**Automated (no mobile UI):**
```bash
cd "$PROJECT_ROOT"
bun run src/index.ts &
until curl -sf http://localhost:3000/health >/dev/null 2>&1; do :; done
bun test src/verification/tlsn-validation.test.ts
# Then run Phase 2 commands below
```

**Full runbook (includes mobile app on iOS simulator):**
Use `/test-tlsn full` and follow all phases below.

---

Phases: `full` (default) | `server` | `query` | `mobile` | `requester` | `teardown`

- `full` — Run all phases 1-5 in order.
- Individual phase names run only that phase.

If `$ARGUMENTS` is empty or `full`, run all phases in order.

---

## Phase 1: Server (`server`)

Start the Anchr server.

```bash
cd "$PROJECT_ROOT"
pkill -f "bun.*src/index.ts" 2>/dev/null || true
bun run src/index.ts &
```

**Verification:**
```bash
curl -s http://localhost:3000/health | jq .
# Expected: {"ok": true}
```

---

## Phase 2: Create & Submit TLSNotary Query (`query`)

### 2a. Create a TLSNotary query

```bash
QUERY_ID=$(curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Verify BTC price on CoinGecko",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": {
      "target_url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      "conditions": [
        { "type": "jsonpath", "expression": "bitcoin.usd", "description": "BTC price exists" }
      ]
    },
    "bounty": { "amount_sats": 21 },
    "ttl_seconds": 600
  }' | jq -r '.query_id')
echo "Created: $QUERY_ID"
```

**Verification:**
```bash
curl -s "http://localhost:3000/queries/$QUERY_ID" | jq '{
  status, verification_requirements, tlsn_requirements
}'
# Expected: status="pending", verification_requirements=["tlsn"], tlsn_requirements present
```

### 2b. Submit TLSNotary attestation

```bash
TIMESTAMP=$(($(date +%s) * 1000 - 5000))
curl -s -X POST "http://localhost:3000/queries/${QUERY_ID}/submit" \
  -H "Content-Type: application/json" \
  -d "{
    \"tlsn_attestation\": {
      \"attestation_doc\": \"$(echo -n 'test-attestation' | base64)\",
      \"server_name\": \"api.coingecko.com\",
      \"request_url\": \"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd\",
      \"revealed_body\": \"{\\\"bitcoin\\\":{\\\"usd\\\":68432.50}}\",
      \"notary_pubkey\": \"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4\",
      \"session_timestamp\": ${TIMESTAMP}
    }
  }" | jq '{ok, message, verification}'
```

**Expected:**
- `ok: true`
- `verification.passed: true`
- Checks include: server name matches, attestation fresh, condition passed

### 2c. Verify failure cases

```bash
# Missing attestation → should fail
FAIL_QID=$(curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Fail test — no attestation",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": { "target_url": "https://example.com" },
    "ttl_seconds": 120
  }' | jq -r '.query_id')

curl -s -X POST "http://localhost:3000/queries/${FAIL_QID}/submit" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '{ok, message}'
# Expected: ok=false, "TLSNotary: no attestation provided"

# Domain mismatch → should fail
FAIL_QID2=$(curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Fail test — domain mismatch",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": { "target_url": "https://api.coingecko.com/price" },
    "ttl_seconds": 120
  }' | jq -r '.query_id')

TIMESTAMP=$(($(date +%s) * 1000 - 5000))
curl -s -X POST "http://localhost:3000/queries/${FAIL_QID2}/submit" \
  -H "Content-Type: application/json" \
  -d "{
    \"tlsn_attestation\": {
      \"attestation_doc\": \"$(echo -n 'test' | base64)\",
      \"server_name\": \"evil.example.com\",
      \"request_url\": \"https://evil.example.com/price\",
      \"revealed_body\": \"{}\",
      \"notary_pubkey\": \"abc\",
      \"session_timestamp\": ${TIMESTAMP}
    }
  }" | jq '{ok, message}'
# Expected: ok=false, "server name ... does not match target"

# Schema validation → should fail
curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Fail test — bad URL",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": { "target_url": "not-a-url" }
  }' | jq '{error, issues}'
# Expected: error="Invalid query payload", issues[0].path="tlsn_requirements.target_url"
```

### 2d. Verify query detail API

```bash
curl -s "http://localhost:3000/queries/${QUERY_ID}" | jq '{
  status,
  has_attestation: (.result.tlsn_attestation != null),
  server_name: .result.tlsn_attestation.server_name,
  revealed_body: .result.tlsn_attestation.revealed_body,
  verification_passed: .verification.passed
}'
# Expected: status="approved", has_attestation=true, verification_passed=true
```

---

## Phase 3: Mobile App Test (`mobile`)

Test the Worker mobile app on iOS Simulator.

### 3a. Start Metro bundler

```bash
cd "$PROJECT_ROOT/mobile"
bun install
bunx expo start --port 8082 &
```

### 3b. Open app in Expo Go

```bash
xcrun simctl openurl booted "exp://192.168.10.101:8082"
```

Wait ~12 seconds for the app to load. Dismiss any permission dialogs (notifications, location).

### 3c. Create a pending query and open detail

```bash
cd "$PROJECT_ROOT"
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
echo "MOBILE_QID=$MOBILE_QID"
```

Wait for the mobile app to poll (~5s), then:
1. Pull to refresh if needed
2. Tap the "Verify ETH price on CoinGecko" card → detail screen opens
3. Verify: Pending status, description, bounty, Camera/Import buttons

### 3d. Submit attestation and verify proof display

```bash
TIMESTAMP=$(($(date +%s) * 1000 - 5000))
curl -s -X POST "http://localhost:3000/queries/${MOBILE_QID}/submit" \
  -H "Content-Type: application/json" \
  -d "{
    \"tlsn_attestation\": {
      \"attestation_doc\": \"$(echo -n 'test-attestation' | base64)\",
      \"server_name\": \"api.coingecko.com\",
      \"request_url\": \"https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd\",
      \"revealed_body\": \"{\\\"ethereum\\\":{\\\"usd\\\":3842.75}}\",
      \"notary_pubkey\": \"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4\",
      \"session_timestamp\": ${TIMESTAMP}
    }
  }" | jq '.ok'
```

Wait ~7 seconds for the app to poll the updated data. Verify on mobile:
1. Status changes to **Approved** (green)
2. **VERIFICATION** section: 5 green checkmarks
3. **TLSNOTARY PROOF** section:
   - Lock icon + **api.coingecko.com**
   - Request URL
   - **CONDITIONS**: ETH price exists (green check)
   - **> Server Response** `JSON` (tap to expand → shows `{"ethereum":{"usd":3842.75}}`)
   - Timestamp + Notary pubkey
   - **> Raw attestation data** (tap to expand → full JSON)

### 3e. Take screenshots (MCP)

```
mcp__ios-simulator__screenshot(output_path: "/tmp/tlsn-mobile-proof.png")
```

---

## Phase 4: Requester Web UI (`requester`)

### 4a. Open Requester UI

Open `http://localhost:3000/requester` in a browser (or use gstack browse).

### 4b. Verify query display

1. Click the "Verify BTC price on CoinGecko" card to expand
2. Verify:
   - **承認** badge (green)
   - **検証OK** with all 5 TLSNotary checks (green checkmarks)
   - **TLSNotary Proof** panel:
     - Lock icon + api.coingecko.com
     - Conditions: BTC price exists
     - **Server Response** `JSON` → click to expand → `{"bitcoin":{"usd":68432.50}}`
     - Notary pubkey + timestamp
     - **Raw attestation data** → click to expand → full attestation JSON

---

## Phase 5: Teardown (`teardown`)

```bash
pkill -f "bun.*src/index.ts" 2>/dev/null || true
pkill -f "expo start" 2>/dev/null || true
```

---

## Unit Tests

```bash
cd "$PROJECT_ROOT"
bun test src/verification/tlsn-validation.test.ts
# 21 tests: condition evaluation, freshness, notary trust, domain matching, verify() integration
```

---

## Checklist

| Step | Expected |
|------|----------|
| `POST /queries` with `tlsn` | Query created with `tlsn_requirements` |
| `GET /queries/:id` | `tlsn_requirements` in response |
| Submit with valid attestation | `ok: true`, all 5 checks pass |
| Submit without attestation | `ok: false`, "no attestation provided" |
| Submit with wrong domain | `ok: false`, "does not match target" |
| Invalid schema (bad URL) | 400 with Zod validation error |
| Mobile: pending query | Card shows Pending + bounty + timer |
| Mobile: after submit | VERIFICATION + TLSNOTARY PROOF sections |
| Mobile: Server Response | Tap to expand → JSON pretty-printed |
| Requester: expanded card | 検証OK + TLSNotary Proof panel |
| Requester: Server Response | Click to expand → JSON displayed |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| TLSNotary Proof section missing on mobile | Metro cache stale. Restart with `bunx expo start --port 8082 --clear` |
| COMPLETED queries can't be tapped | Expected — HistoryRow has no navigation. Use pending queries for detail view testing |
| Expo Go "No script URL" error | App was built as dev client. Use `exp://` URL instead of launching `com.anchr.worker` |
| Server Response won't expand | Scroll down first — the Pressable may be off-screen |

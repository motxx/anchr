---
name: test-regtest
description: End-to-end regtest testing with Docker (Lightning, Cashu, Nostr, Blossom) + Anchr server + mobile app on iOS simulator. Use when testing the full bounty query flow.
disable-model-invocation: false
argument-hint: "[full|auto|infra|server|bounty|mobile|submit|teardown]"
---

# Regtest E2E Test Runbook

Run the full Anchr end-to-end test on a local regtest Lightning network with Cashu mint.

## Quick start

All commands assume `PROJECT_ROOT` is the repo root. Set it first:
```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

**Automated tests (Phase 1-3, 5 — no mobile UI):**
```bash
# 1. Start infra + init Lightning
docker compose up -d && sleep 25 && ./scripts/init-regtest.sh && docker compose restart cashu-mint && sleep 5

# 2. Run E2E tests
bun run test:regtest
```

**Full runbook (includes mobile app on iOS simulator):**
Use `/test-regtest full` and follow all phases below.

---

Phases: `full` (default) | `auto` | `infra` | `server` | `bounty` | `mobile` | `submit` | `teardown`

- `auto` — Start infra, run `bun run test:regtest`, teardown. No mobile UI.
- `full` — Run all phases 1-6 in order including mobile.
- Individual phase names run only that phase.

If `$ARGUMENTS` is empty or `full`, run all phases 1-6 in order.
If `$ARGUMENTS` is `auto`, run infra → `bun run test:regtest` → teardown.

---

## Phase 1: Infrastructure (`infra`)

Start Docker services and initialize the regtest Lightning network.

```bash
# 1a. Start all Docker services
cd "$PROJECT_ROOT"
docker compose up -d

# 1b. Wait for LND nodes to be ready (~25s)
echo "Waiting for LND nodes to start..."
sleep 25

# 1c. Initialize regtest: create wallet, mine blocks, fund LND, open channel
./scripts/init-regtest.sh

# 1d. Restart cashu-mint (it often exits because LND wasn't ready at first boot)
docker compose restart cashu-mint
sleep 5
```

**Verification checks:**
- Run `docker compose ps -a` and confirm all 6 services are running: relay, blossom, bitcoind, lnd-mint, lnd-user, cashu-mint. **Check cashu-mint is not "Exited".**
- Run `docker compose exec -T lnd-user lncli --network regtest --rpcserver lnd-user:10009 channelbalance` and confirm non-zero `local_balance`
- Run `curl -s http://localhost:3338/v1/info` and confirm Cashu mint responds with JSON containing `"name":"Cashu mint"`

If any service fails, check `docker compose logs <service>` for errors.

### Known issues
- `cashu-mint` often exits on first boot because it tries to connect to `lnd-mint:8081` before LND is ready. The `docker compose restart cashu-mint` in step 1d fixes this.
- If `createwallet` fails with "Database already exists", the script auto-falls back to `loadwallet`.

---

## Phase 2: Anchr Server (`server`)

Start the Anchr server with local infrastructure endpoints.

```bash
cd "$PROJECT_ROOT"

# Kill any existing server process first
pkill -f "bun.*src/server.ts" 2>/dev/null || true

NOSTR_RELAYS=ws://localhost:7777 \
BLOSSOM_SERVERS=http://localhost:3333 \
CASHU_MINT_URL=http://localhost:3338 \
bun run dev &
```

**Verification checks:**
- `curl -s http://localhost:3000/queries` should return JSON (empty array `[]` is OK)
- Worker UI at http://localhost:3000 should be accessible
- Requester UI at http://localhost:3000/requester should be accessible

---

## Phase 3: Create Bounty Query (`bounty`)

Mint Cashu tokens via regtest Lightning and create test queries with bounty.

### Basic usage

```bash
cd "$PROJECT_ROOT"

# Photo-required query (default — GPS verification enabled)
CASHU_MINT_URL=http://localhost:3338 bun run scripts/create-bounty-query.ts

# Text-only query (for API submit testing — no photo required)
CASHU_MINT_URL=http://localhost:3338 bun run scripts/create-bounty-query.ts --text-only
```

### Custom queries via API (with per-query GPS distance)

```bash
# Tight radius (500m) — e.g., specific intersection
curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "渋谷スクランブル交差点の現在の混雑状況を撮影してください",
    "location_hint": "渋谷スクランブル交差点 (東京都渋谷区道玄坂2丁目)",
    "expected_gps": {"lat": 35.6595, "lon": 139.7004},
    "max_gps_distance_km": 0.5,
    "ttl_seconds": 3600,
    "verification_requirements": ["gps"]
  }'

# Medium radius (1km) — e.g., specific building/shop
curl -s -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "チッタのサンマルクカフェは空いていますか？混み具合を撮影してください",
    "location_hint": "ラチッタデッラ MAGGIORE棟 サンマルクカフェ (神奈川県川崎市川崎区小川町4-1)",
    "expected_gps": {"lat": 35.5311, "lon": 139.6978},
    "max_gps_distance_km": 1,
    "ttl_seconds": 3600,
    "verification_requirements": ["gps"]
  }'
```

### Query parameters reference

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `description` | yes | — | What to observe/photograph |
| `location_hint` | no | — | Human-readable location |
| `expected_gps` | no | — | `{lat, lon}` for proximity check |
| `max_gps_distance_km` | no | 50 | Max distance from expected_gps (0.01–1000 km) |
| `verification_requirements` | no | `["gps","ai_check"]` | `["gps","nonce","timestamp","oracle","ai_check"]` |
| `ttl_seconds` | no | 600 | Query lifetime (60–86400) |
| `bounty` | no | — | `{amount_sats, cashu_token}` |

### Query types

| Mode | verification_requirements | API submit without photo |
|------|--------------------------|--------------------------|
| Photo required (default) | `["gps", "ai_check"]` | Rejected |
| `--text-only` / `[]` | `[]` | Accepted with GPS + notes |

---

## Phase 4: Mobile App Test (`mobile`)

Launch the iOS simulator and test the Worker mobile app.

### 4a. Build and start the mobile app

**First time or after clean:**
```bash
cd mobile
bun install
npx expo prebuild --platform ios --clean
npx expo run:ios --device "iPhone 17 Pro"
```

**Subsequent runs (app already built):**
```bash
cd mobile
bun run ios
```

Or launch via MCP:
```
mcp__ios-simulator__launch_app(bundle_id: "com.anchr.worker", terminate_running: true)
```

### 4b. Set simulator location

Change the simulator's GPS location to test distance-based features:

```bash
# Get simulator UDID
SIM_UDID=$(xcrun simctl list devices booted -j | python3 -c "import json,sys; devs=json.load(sys.stdin)['devices']; print([d['udid'] for ds in devs.values() for d in ds if d['state']=='Booted'][0])")

# Set to specific locations
xcrun simctl location $SIM_UDID set "35.6595,139.7004"   # 渋谷スクランブル交差点
xcrun simctl location $SIM_UDID set "35.5311,139.6978"   # ラチッタデッラ (川崎)
xcrun simctl location $SIM_UDID set "34.6937,135.5023"   # 大阪駅
xcrun simctl location $SIM_UDID clear                     # Reset to default
```

After changing location, restart the app to pick up the new position:
```
mcp__ios-simulator__launch_app(bundle_id: "com.anchr.worker", terminate_running: true)
```

### 4c. Configure the app (first time only)
- Open the **Settings** tab in the app
- Set Server URL to `http://localhost:3000`
- Save settings

### 4d. Verify query display
1. Go to **Queries** tab — queries should appear sorted by distance
2. Verify: "Pending" badge, description, location, bounty amount, countdown timer
3. Nearby queries appear at the top; distant queries show distance (e.g., "14km")
4. Tap a query card to open detail view
5. Verify: full description, location, bounty, Camera/Import buttons
6. If query was submitted and rejected, verify VERIFICATION section shows checks/failures

### 4e. Use iOS Simulator MCP (if available)
Use MCP tools to automate verification:
- `mcp__ios-simulator__screenshot` — capture each step
- `mcp__ios-simulator__ui_describe_all` — get accessibility info for tap coordinates
- `mcp__ios-simulator__ui_tap` — tap UI elements (use accessibility frame coordinates, NOT screenshot coordinates)

### Known issues
- **Back button**: Use `ui_describe_all` to get the exact Back button frame and tap its center. The Back button is inside a navigation stack and tapping the tab bar does not work from the detail view.
- **Document picker**: Files added via `xcrun simctl addmedia` go to Photos, not Files app. To test Import with a file, manually place it in the simulator's Files app or use Camera instead.

---

## Phase 5: Submit via API (`submit`)

Since file selection in the simulator is limited, use the API to test the full submit + bounty release flow.

### 5a. Verify GPS-required query rejects empty submission

```bash
QUERY_ID=$(curl -s http://localhost:3000/queries | python3 -c "
import json,sys
qs = [q for q in json.load(sys.stdin) if 'gps' in q.get('verification_requirements', [])]
print(qs[0]['id'] if qs else '')
")

# Submit without attachments — should be REJECTED
curl -s -X POST "http://localhost:3000/queries/${QUERY_ID}/submit" \
  -H "Content-Type: application/json" \
  -d '{"gps": {"lat": 35.6595, "lon": 139.7004}, "notes": "text only attempt"}'
```

**Expected:** `ok: false`, failure: "no media evidence provided — photos are required when GPS or nonce verification is enabled"

### 5b. Submit to text-only query (bounty release flow)

```bash
QUERY_ID=$(curl -s http://localhost:3000/queries | python3 -c "
import json,sys
qs = [q for q in json.load(sys.stdin) if 'gps' not in q.get('verification_requirements', [])]
print(qs[0]['id'] if qs else '')
")

# Submit a text result — should PASS
curl -s -X POST "http://localhost:3000/queries/${QUERY_ID}/submit" \
  -H "Content-Type: application/json" \
  -d '{"gps": {"lat": 35.6595, "lon": 139.7004}, "notes": "混雑してます"}'
```

**Expected:** `ok: true`, `payment_status: "released"`, `cashu_token: "cashuB..."` returned

### 5c. Verify per-query distance filter

```bash
# Worker at 渋谷駅前 (~200m from 交差点) — sees 渋谷 query (max 0.5km)
curl -s "http://localhost:3000/queries?lat=35.6580&lon=139.7016" | python3 -c "
import json,sys; qs=json.load(sys.stdin)
for q in qs: print(f'  {q[\"description\"][:30]}... (max {q.get(\"max_gps_distance_km\",50)}km)')
print(f'{len(qs)} queries')
"

# Worker at 川崎駅前 (~500m from ラチッタデッラ) — sees 川崎 query (max 1km)
curl -s "http://localhost:3000/queries?lat=35.5309&lon=139.7006" | python3 -c "
import json,sys; qs=json.load(sys.stdin)
for q in qs: print(f'  {q[\"description\"][:30]}... (max {q.get(\"max_gps_distance_km\",50)}km)')
print(f'{len(qs)} queries')
"

# Worker at 武蔵小杉 (~8km/~6km) — sees nothing (both exceeded)
curl -s "http://localhost:3000/queries?lat=35.5764&lon=139.6594" | python3 -c "
import json,sys; print(f'{len(json.load(sys.stdin))} queries')
"
```

**Verification checks:**
- Queries only visible to workers within `max_gps_distance_km` of `expected_gps`
- `max_distance_km` query param on GET /queries sets fallback for queries without `max_gps_distance_km`
- Queries without `expected_gps` are always visible to all workers

### Known issues
- **Wallet balance not updated**: API-submitted results return the Cashu token in the response, but the mobile app's Wallet only shows earnings from in-app submissions. This is expected — the app needs to receive and store the token itself.

---

## Phase 6: Teardown (`teardown`)

```bash
cd "$PROJECT_ROOT"

# Stop the Anchr server
pkill -f "bun.*src/server.ts" || true

# Stop Docker services
docker compose down

# Reset simulator location (optional)
xcrun simctl location booted clear
```

---

## Gotchas

These are non-obvious facts discovered through actual testing. The agent WILL get these wrong without being told.

- **Settings load race condition**: Zustand store loads AsyncStorage async. If React Query fires `fetchQueries` before `load()` completes, it uses the default URL (localhost). The fix is `_layout.tsx` awaiting `load()` before rendering children.
- **Dev-mode URL override**: `settings.ts` had logic to force `localhost` in `__DEV__` mode. This silently overrides any saved server URL (e.g., fly.io). Removed — always use the stored value.
- **Simulator text input unreliable**: Triple-tap to select-all often fails. Long-press triggers Save button. To change Settings fields reliably, write directly to AsyncStorage's `manifest.json` at `~/Library/Developer/CoreSimulator/Devices/{UDID}/data/Containers/Data/Application/{APP}/Library/Application Support/com.anchr.worker/RCTAsyncLocalStorage_V1/manifest.json`, then restart the app.
- **CORS required for web**: The Expo web app runs on a different port (8082) than the server (3000). Without `cors()` middleware on Hono, all fetches fail silently — the app shows "No pending queries" with no visible error.
- **HEIC images don't render in `<Image>`**: Browsers (except Safari) and react-native-web can't render HEIC. The `ImagePreviewOrFallback` component falls back to a file icon for non-previewable formats.
- **tsconfig picks up mobile/**: Without `"exclude": ["mobile"]` in the root tsconfig, `tsc --noEmit` fails because mobile's deps (expo, react-native) aren't in the root node_modules. CI will fail on typecheck.
- **Docker context bloat**: Without `.dockerignore` entries for `mobile/`, `e2e/`, `scripts/`, the build context is ~275MB instead of ~800KB. First deploy will timeout.
- **testnut.cashu.space is FakeWallet**: All Lightning invoices auto-paid, tokens are worthless test ecash. Not real Bitcoin testnet sats.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `cashu-mint` exits immediately | LND wasn't ready. Run `docker compose restart cashu-mint` after init-regtest.sh |
| `createwallet` error -4 "Database already exists" | Script auto-falls back to `loadwallet`. If still failing, `docker compose down -v` to wipe volumes |
| `lnd-mint` keeps restarting | Wait longer before init-regtest.sh (increase sleep to 30-40s) |
| Invoice payment fails | Verify channel is active: `docker compose exec -T lnd-user lncli --network regtest --rpcserver lnd-user:10009 listchannels` |
| iOS build fails with "duplicate symbol" | Remove `react-native-worklets` from mobile/package.json (conflicts with reanimated 3.17+) |
| iOS build fails with "undefined_arch" | Use `npx expo run:ios` instead of raw `xcodebuild` |
| Mobile app can't reach server | Use Mac's IP instead of localhost (e.g., `http://192.168.x.x:3000`) |
| Queries disappear on mobile | Known polling issue - was fixed. Check server logs for errors |
| Query detail shows "not found" | Ensure the server is running and the query hasn't expired |
| Document picker won't select files | Simulator limitation. Use API submit (Phase 5) for automated testing |
| Submit rejected with "photos required" | Query has GPS/nonce verification. Use `--text-only` query for API testing, or provide real C2PA photos |
| Queries not filtering by distance | Ensure `expected_gps` and `max_gps_distance_km` are set on the query |

## Port Reference

| Service | Port | URL |
|---------|------|-----|
| Anchr Server | 3000 | http://localhost:3000 |
| Nostr Relay | 7777 | ws://localhost:7777 |
| Blossom | 3333 | http://localhost:3333 |
| Cashu Mint | 3338 | http://localhost:3338 |
| LND User REST | 8081 | https://localhost:8081 |
| LND User gRPC | 10009 | localhost:10009 |
| Metro Bundler | 8081 | http://localhost:8081 (conflicts with LND — Expo uses dynamic port) |

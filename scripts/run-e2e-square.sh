#!/usr/bin/env bash
# Square E2E runner — clean DB, container logs visible, full HTLC flow
#
# Usage:
#   ./scripts/run-e2e-square.sh
#
# Prerequisites:
#   - SANDBOX_ACCESS_TOKEN in .env (or exported)
#   - crates/tlsn-prover/target/release/tlsn-prove built
#   - Docker running
set -euo pipefail
cd "$(dirname "$0")/.."

LOGS_DIR="/tmp/anchr-e2e-logs"
rm -rf "$LOGS_DIR"
mkdir -p "$LOGS_DIR"

# Track background PIDs for cleanup
PIDS=()
cleanup() {
  echo ""
  echo "[cleanup] Stopping background processes..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  # Don't tear down containers — user may want to inspect
  echo "[cleanup] Done. Containers still running (use 'docker compose down -v' to remove)."
}
trap cleanup EXIT

echo "=========================================="
echo " Anchr · Square E2E (Clean Start)"
echo "=========================================="

# --- Preflight checks ---
if [ ! -f crates/tlsn-prover/target/release/tlsn-prove ]; then
  echo "[error] TLSNotary prover not found. Build first:"
  echo "  cd crates/tlsn-prover && cargo build --release"
  exit 1
fi

# Load .env if present (Bun does this automatically, but we need it for shell checks)
if [ -f .env ]; then
  set -a; source .env; set +a
fi

if [ -z "${SANDBOX_ACCESS_TOKEN:-}" ]; then
  echo "[error] SANDBOX_ACCESS_TOKEN not set (check .env)"
  exit 1
fi

# ============================================================
# 0. Kill any existing Anchr server (in-memory store = stale data)
# ============================================================
if lsof -ti:3000 >/dev/null 2>&1; then
  echo ""
  echo "[0] Killing existing process on port 3000..."
  lsof -ti:3000 | xargs kill 2>/dev/null || true
  sleep 1
  echo "  ✓ Port 3000 freed"
fi

# ============================================================
# 1. Clean slate — remove containers + volumes
# ============================================================
echo ""
echo "[1/6] Tearing down containers + volumes (fresh DB)..."
docker compose down -v 2>/dev/null || true

# Verify no leftover containers
REMAINING=$(docker compose ps -q 2>/dev/null | wc -l | tr -d ' ')
if [ "$REMAINING" != "0" ]; then
  echo "  ⚠ $REMAINING containers still running, force removing..."
  docker compose kill 2>/dev/null || true
  docker compose down -v --remove-orphans 2>/dev/null || true
fi

# Verify volumes are gone
for vol in anchr_relay-data anchr_blossom-data anchr_bitcoin-data anchr_lnd-mint-data anchr_lnd-user-data; do
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    echo "  ⚠ Removing leftover volume $vol..."
    docker volume rm "$vol" 2>/dev/null || true
  fi
done
echo "  ✓ All containers stopped, volumes removed"

# ============================================================
# 2. Start all containers
# ============================================================
echo ""
echo "[2/6] Starting containers..."
docker compose up -d

# Verify all containers are actually running
echo "  Waiting for containers to be ready..."
EXPECTED_SERVICES="bitcoind blossom cashu-mint lnd-mint lnd-user relay tlsn-verifier"
for attempt in $(seq 1 30); do
  ALL_UP=true
  for svc in $EXPECTED_SERVICES; do
    STATUS=$(docker compose ps --format "{{.State}}" "$svc" 2>/dev/null)
    if [ "$STATUS" != "running" ]; then
      ALL_UP=false
      break
    fi
  done
  if $ALL_UP; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "  ✗ Some containers failed to start:"
    docker compose ps
    exit 1
  fi
  sleep 1
done
echo "  ✓ All 7 containers running"

# ============================================================
# 3. Stream container logs (per-service + combined)
# ============================================================
echo ""
echo "[3/6] Starting container log streams..."

SERVICES=(relay blossom tlsn-verifier bitcoind lnd-mint lnd-user cashu-mint)
for svc in "${SERVICES[@]}"; do
  docker compose logs -f "$svc" > "$LOGS_DIR/$svc.log" 2>&1 &
  PIDS+=($!)
done

# Combined log
docker compose logs -f --tail=0 > "$LOGS_DIR/all.log" 2>&1 &
PIDS+=($!)

echo "  ✓ Logs streaming to $LOGS_DIR/"
echo ""
echo "  ┌────────────────────────────────────────┐"
echo "  │  tail -f $LOGS_DIR/all.log   │"
echo "  │  tail -f $LOGS_DIR/relay.log          │"
echo "  │  tail -f $LOGS_DIR/cashu-mint.log     │"
echo "  │  tail -f $LOGS_DIR/lnd-mint.log       │"
echo "  │  tail -f $LOGS_DIR/lnd-user.log       │"
echo "  │  tail -f $LOGS_DIR/tlsn-verifier.log  │"
echo "  └────────────────────────────────────────┘"

# ============================================================
# 4. Init regtest Lightning network
# ============================================================
echo ""
echo "[4/6] Waiting for LND nodes to start (25s)..."
sleep 25

echo "[4/6] Initializing regtest Lightning network..."
./scripts/init-regtest.sh

# Restart cashu-mint so it picks up the funded LND
echo "[4/6] Restarting cashu-mint (needs funded LND)..."
docker compose restart cashu-mint
sleep 5

# ============================================================
# 5. Show container health
# ============================================================
echo ""
echo "[5/6] Container status:"
echo "  ──────────────────────────────────────────"
docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || docker compose ps
echo "  ──────────────────────────────────────────"

# ============================================================
# 6. Start Anchr server + run E2E
# ============================================================
echo ""
echo "[6/6] Starting Anchr server..."

NOSTR_RELAYS=ws://localhost:7777 \
BLOSSOM_SERVERS=http://localhost:3333 \
CASHU_MINT_URL=http://localhost:3338 \
bun --hot src/server.ts > "$LOGS_DIR/anchr-server.log" 2>&1 &
ANCHR_PID=$!
PIDS+=($ANCHR_PID)

# Wait for server to be ready
echo "  Waiting for Anchr server..."
for i in $(seq 1 15); do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    echo "  ✓ Anchr server ready (http://localhost:3000)"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "  ✗ Anchr server failed to start. Check $LOGS_DIR/anchr-server.log"
    exit 1
  fi
  sleep 1
done

echo "  Anchr server logs → $LOGS_DIR/anchr-server.log"

# Run the E2E
echo ""
echo "=========================================="
echo " Running Square E2E..."
echo "=========================================="
echo ""

bun run scripts/e2e-square-full.ts

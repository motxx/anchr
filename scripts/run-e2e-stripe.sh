#!/usr/bin/env bash
# Stripe E2E runner — clean DB, container logs visible, full HTLC flow
#
# Usage:
#   ./scripts/run-e2e-stripe.sh
#
# Prerequisites:
#   - STRIPE_SECRET_KEY in .env (test mode key starting with sk_test_)
#   - crates/tlsn-prover/target/release/tlsn-prove built
#   - Docker running
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env before docker-compose-env so COMPOSE_PROJECT_NAME/port overrides
# are honored if a developer pins a local stack explicitly.
if [ -f .env ]; then
  set -a; source .env; set +a
fi

export ANCHR_DOCKER_ISOLATION="${ANCHR_DOCKER_ISOLATION:-worktree}"
source ./scripts/docker-compose-env.sh

LOGS_DIR="/tmp/anchr-e2e-logs-${COMPOSE_PROJECT_NAME}"
rm -rf "$LOGS_DIR"
mkdir -p "$LOGS_DIR"

PIDS=()
cleanup() {
  echo ""
  echo "[cleanup] Stopping background processes..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  echo "[cleanup] Tearing down Docker Compose stack..."
  docker compose down -v --remove-orphans --timeout 10 2>/dev/null || true
  echo "[cleanup] Done. Containers, networks, and volumes removed."
}
trap cleanup EXIT

echo "=========================================="
echo " Anchr · Stripe E2E (Clean Start)"
echo "=========================================="

if [ ! -f crates/tlsn-prover/target/release/tlsn-prove ]; then
  echo "[error] TLSNotary prover not found. Build first:"
  echo "  cd crates/tlsn-prover && cargo build --release"
  exit 1
fi

if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  echo "[error] STRIPE_SECRET_KEY not set (check .env)"
  exit 1
fi

# In-memory store = stale data, so kill any existing Anchr server.
if lsof -ti:"$ANCHR_HTTP_API_PORT" >/dev/null 2>&1; then
  echo ""
  echo "[0] Killing existing process on port $ANCHR_HTTP_API_PORT..."
  lsof -ti:"$ANCHR_HTTP_API_PORT" | xargs kill 2>/dev/null || true
  sleep 1
  echo "  ✓ Port $ANCHR_HTTP_API_PORT freed"
fi

echo ""
echo "[1/6] Tearing down containers + volumes (fresh DB)..."
echo "  Compose project: $COMPOSE_PROJECT_NAME"
docker compose down -v 2>/dev/null || true

REMAINING=$(docker compose ps -q 2>/dev/null | wc -l | tr -d ' ')
if [ "$REMAINING" != "0" ]; then
  echo "  ⚠ $REMAINING containers still running, force removing..."
  docker compose kill 2>/dev/null || true
  docker compose down -v --remove-orphans 2>/dev/null || true
fi

for vol in "${COMPOSE_PROJECT_NAME}_relay-data" "${COMPOSE_PROJECT_NAME}_blossom-data" "${COMPOSE_PROJECT_NAME}_bitcoin-data" "${COMPOSE_PROJECT_NAME}_lnd-mint-data" "${COMPOSE_PROJECT_NAME}_lnd-user-data"; do
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    echo "  ⚠ Removing leftover volume $vol..."
    docker volume rm "$vol" 2>/dev/null || true
  fi
done
echo "  ✓ All containers stopped, volumes removed"

echo ""
echo "[2/6] Starting containers..."
docker compose up -d

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

echo ""
echo "[3/6] Starting container log streams..."

SERVICES=(relay blossom tlsn-verifier bitcoind lnd-mint lnd-user cashu-mint)
for svc in "${SERVICES[@]}"; do
  docker compose logs -f "$svc" > "$LOGS_DIR/$svc.log" 2>&1 &
  PIDS+=($!)
done

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

echo ""
echo "[4/6] Waiting for LND nodes to start (25s)..."
sleep 25

echo "[4/6] Initializing regtest Lightning network..."
./scripts/init-regtest.sh

echo "[4/6] Restarting cashu-mint (needs funded LND)..."
docker compose restart cashu-mint
sleep 5

echo ""
echo "[5/6] Container status:"
echo "  ──────────────────────────────────────────"
docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || docker compose ps
echo "  ──────────────────────────────────────────"

echo ""
echo "[6/6] Starting Anchr server..."

HTTP_API_PORT="$ANCHR_HTTP_API_PORT" \
NOSTR_RELAYS="ws://localhost:${ANCHR_RELAY_PORT}" \
NOSTR_RELAY_URL="ws://localhost:${ANCHR_RELAY_PORT}" \
BLOSSOM_SERVERS="http://localhost:${ANCHR_BLOSSOM_PORT}" \
CASHU_MINT_URL="http://localhost:${ANCHR_CASHU_MINT_PORT}" \
deno run --watch --allow-all --env example/anchr-reference-host/server.ts > "$LOGS_DIR/anchr-server.log" 2>&1 &
ANCHR_PID=$!
PIDS+=($ANCHR_PID)

echo "  Waiting for Anchr server..."
for i in $(seq 1 15); do
  if curl -sf "http://localhost:${ANCHR_HTTP_API_PORT}/health" > /dev/null 2>&1; then
    echo "  ✓ Anchr server ready (http://localhost:${ANCHR_HTTP_API_PORT})"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "  ✗ Anchr server failed to start. Check $LOGS_DIR/anchr-server.log"
    exit 1
  fi
  sleep 1
done

echo "  Anchr server logs → $LOGS_DIR/anchr-server.log"

echo ""
echo "=========================================="
echo " Running Stripe E2E..."
echo "=========================================="
echo ""

ANCHR_SERVER_URL="http://localhost:${ANCHR_HTTP_API_PORT}" \
CASHU_MINT_URL="http://localhost:${ANCHR_CASHU_MINT_PORT}" \
TLSN_VERIFIER_HOST="localhost:${ANCHR_TLSN_TCP_PORT}" \
deno run --allow-all --env scripts/e2e-stripe-full.ts

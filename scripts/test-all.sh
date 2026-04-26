#!/usr/bin/env bash
# Unified test runner — runs all tests in correct order.
#
# Usage:
#   ./scripts/test-all.sh              # local + docker tests (full suite)
#   ./scripts/test-all.sh --local      # local tests only (no Docker)
#   ./scripts/test-all.sh --docker     # docker tests only (assumes services up or starts them)
#   ./scripts/test-all.sh --ci         # CI mode: same as full but skips docker teardown on failure for logs
#
# Exit codes:
#   0 = all passed
#   1 = test failure
#   2 = infrastructure setup failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

MODE="${1:-full}"
FAILED=0
DOCKER_STARTED=0

# Colors (disabled in CI if no tty)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BOLD=''; NC=''
fi

step() { echo -e "\n${BOLD}=== $1 ===${NC}"; }
pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAILED=1; }
skip() { echo -e "  ${YELLOW}SKIP${NC} $1"; }

run_test() {
  local name="$1"; shift
  if "$@" 2>&1; then
    pass "$name"
  else
    fail "$name"
  fi
}

cleanup() {
  if [ "$DOCKER_STARTED" = "1" ]; then
    step "Teardown"
    docker compose down --timeout 10 2>/dev/null || true
    echo "  Docker services stopped."
  fi
}

# --- Phase 1: Local tests (no Docker) ---

run_local() {
  step "Phase 1: Lint & Local Tests"

  run_test "arch lint"        deno task lint:arch
  run_test "invariant lint"   deno task lint:invariants
  run_test "path leak lint"   deno task lint:paths
  run_test "dep audit"        deno task lint:deps
  run_test "unit tests"       deno task test:unit
  run_test "protocol tests"   deno task test:protocol
  run_test "FROST tests"      deno task test:frost
  run_test "integration tests" deno task test:integration
  run_test "example tests"    deno task test:example
}

# --- Phase 1.5: Pentest (needs app server running) ---

run_pentest() {
  step "Phase 1.5: Penetration Tests"

  # Start the server for pentest. RATE_LIMIT_MAX is bumped because the
  # DOS + SSRF + fuzz tests issue ~150 requests from the same socket IP;
  # the default 60/min would starve every downstream test. The rate-limit
  # test isolates itself with a distinct x-real-ip bucket and fires past
  # this ceiling to verify the limiter actually trips.
  local port=8091
  HTTP_API_KEYS=pentest-key-001 PORT=$port RATE_LIMIT_MAX=500 \
    deno run --allow-all src/infrastructure/server.ts &
  local server_pid=$!

  # Poll /health for up to 30s — CI cold-start (tailwind CSS build + Deno cache)
  # can exceed 3s on a fresh runner.
  if ! wait_for_service "pentest server" "http://localhost:$port/health" 15; then
    kill $server_pid 2>/dev/null || true
    fail "pentest server start"
    return
  fi

  PENTEST_APP_URL="http://localhost:$port" \
  HTTP_API_KEYS=pentest-key-001 \
  run_test "pentest" deno task test:pentest

  kill $server_pid 2>/dev/null || true
  wait $server_pid 2>/dev/null || true
}

# --- Phase 2: Docker-dependent tests ---

wait_for_service() {
  local name="$1" url="$2" max_attempts="${3:-30}"
  for i in $(seq 1 "$max_attempts"); do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo "  $name ready."
      return 0
    fi
    [ "$((i % 5))" = "0" ] && echo "  Waiting for $name... ($i/$max_attempts)"
    sleep 2
  done
  echo "  ERROR: $name not ready after $((max_attempts * 2))s" >&2
  return 1
}

start_docker_services() {
  step "Phase 2: Start Docker Services"

  # Start relay + blossom
  echo "  Starting relay + blossom..."
  docker compose up -d relay blossom
  DOCKER_STARTED=1

  wait_for_service "Nostr relay" "http://localhost:7777" 15 || return 2
  wait_for_service "Blossom"     "http://localhost:3333" 15 || return 2

  pass "relay + blossom"
}

start_regtest() {
  step "Phase 3: Start Regtest Lightning"

  echo "  Starting bitcoind + LND nodes..."
  docker compose up -d bitcoind lnd-mint lnd-user
  sleep 5

  echo "  Initializing regtest network..."
  if "$SCRIPT_DIR/init-regtest.sh" 2>&1; then
    pass "regtest init"
  else
    fail "regtest init"
    return 2
  fi

  echo "  Starting Cashu mint..."
  docker compose up -d cashu-mint
  sleep 5
  docker compose restart cashu-mint 2>/dev/null || true

  wait_for_service "Cashu mint" "http://localhost:3338/v1/info" 20 || return 2
  pass "cashu mint"
}

run_docker_tests() {
  step "Phase 2: E2E Tests (relay + blossom)"

  NOSTR_RELAYS=ws://localhost:7777 \
  BLOSSOM_SERVERS=http://localhost:3333 \
  run_test "relay e2e" deno task test:e2e:relay

  step "Phase 3: Regtest Tests (HTLC + Cashu)"

  CASHU_MINT_URL=http://localhost:3338 \
  NOSTR_RELAYS=ws://localhost:7777 \
  BLOSSOM_SERVERS=http://localhost:3333 \
  run_test "regtest e2e" deno task test:regtest
}

# --- Main ---

case "$MODE" in
  --local)
    run_local
    run_pentest
    ;;
  --docker)
    trap cleanup EXIT
    start_docker_services || exit 2
    start_regtest || exit 2
    run_docker_tests
    ;;
  --ci|full|*)
    trap cleanup EXIT
    run_local
    run_pentest

    if [ "$FAILED" = "1" ] && [ "$MODE" != "--ci" ]; then
      echo -e "\n${RED}Local tests failed. Skipping Docker tests.${NC}"
      exit 1
    fi

    start_docker_services || exit 2
    start_regtest || exit 2
    run_docker_tests
    ;;
esac

# --- Summary ---

echo ""
if [ "$FAILED" = "0" ]; then
  echo -e "${GREEN}${BOLD}All tests passed.${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}Some tests failed.${NC}"
  exit 1
fi

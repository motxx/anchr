#!/usr/bin/env bash
# Unified test runner — runs all tests in correct order.
#
# Usage:
#   ./scripts/test-all.sh              # local + docker tests (full suite)
#   ./scripts/test-all.sh --local      # local tests only (no Docker)
#   ./scripts/test-all.sh --docker     # docker tests only (assumes services up or starts them)
#   ./scripts/test-all.sh --ci         # CI mode: same as full
#
# Exit codes:
#   0 = all passed
#   1 = test failure
#   2 = infrastructure setup failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

export ANCHR_DOCKER_ISOLATION="${ANCHR_DOCKER_ISOLATION:-worktree}"
source "$SCRIPT_DIR/docker-compose-env.sh"

MODE="${1:-full}"
FAILED=0
DOCKER_STARTED=0
RELAY_URL="ws://localhost:${ANCHR_RELAY_PORT}"
BLOSSOM_URL="http://localhost:${ANCHR_BLOSSOM_PORT}"
CASHU_MINT_URL="http://localhost:${ANCHR_CASHU_MINT_PORT}"
TLSN_VERIFIER_HOST="localhost:${ANCHR_TLSN_TCP_PORT}"

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
    docker compose down -v --remove-orphans --timeout 10 2>/dev/null || true
    echo "  Docker services, networks, and volumes removed."
  fi
}

# --- Phase 1: Local tests (no Docker) ---

run_local() {
  step "Phase 1: Lint & Local Tests"

  # Single chain of every lint that gates merges. Keeping this as
  # `lint:strict` (defined in deno.json) means CI and pre-commit share one
  # source of truth — adding a new lint to the chain auto-propagates here.
  run_test "lint:strict"        deno task lint:strict
  run_test "dep audit"          deno task lint:deps
  run_test "unit tests"         deno task test:unit
  run_test "integration tests"  deno task test:integration
  run_test "protocol e2e"       deno task test:e2e:protocol
  run_test "scripts tests"      deno task test:scripts
  run_test "example tests"      deno task test:examples

  run_rust_gate

  # CI builds frost-signer in a dedicated step before tests run. Mirror that
  # here so e2e/frost/frost-threshold.test.ts actually exercises against the
  # binary locally — without it the FROST e2e silently skips and a green
  # pre-push masks failures that would surface on CI.
  echo "  Building frost-signer..."
  if (cd crates/frost-signer && cargo build --release 2>&1); then
    FROST_E2E_REQUIRE_CORE=1 run_test "frost e2e" deno task test:e2e:frost
  else
    fail "frost-signer build"
  fi
}

# Clippy + test every Rust crate, including tlsn-server which has no other
# CI compile step before `flyctl deploy` builds it. The toolchain is pinned
# by rust-toolchain.toml at the repo root.
run_rust_gate() {
  step "Phase 1: Rust Crate Gate (clippy + test)"
  local crate
  for crate in \
    crates/frost-signer \
    crates/tlsn-prover \
    crates/tlsn-server \
    crates/tlsn-verifier
  do
    run_test "clippy ${crate#crates/}" \
      cargo clippy --manifest-path "$crate/Cargo.toml" --all-targets -- -D warnings
    run_test "cargo test ${crate#crates/}" \
      cargo test --manifest-path "$crate/Cargo.toml"
  done
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

wait_for_tcp_service() {
  local name="$1" host="$2" port="$3" max_attempts="${4:-30}"
  for i in $(seq 1 "$max_attempts"); do
    if bash -c ":</dev/tcp/$host/$port" > /dev/null 2>&1; then
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

  # Wipe any prior state — left-over containers from a previous dev
  # session (anchr-cashu-mint-1, anchr-lnd-*) stash chain height / wallet
  # data that drifts from what init-regtest.sh expects, and the LND
  # mine-150-blocks step racing against an already-mined chain is the
  # classic flake. Volumes and orphan containers go too, so each run
  # starts deterministic.
  echo "  Resetting previous Docker state..."
  echo "  Compose project: ${COMPOSE_PROJECT_NAME}"
  echo "  Ports: relay=${ANCHR_RELAY_PORT} blossom=${ANCHR_BLOSSOM_PORT} cashu=${ANCHR_CASHU_MINT_PORT} tlsn=${ANCHR_TLSN_TCP_PORT}/${ANCHR_TLSN_WS_PORT}"
  docker compose down -v --remove-orphans --timeout 10 2>/dev/null || true

  echo "  Starting relay + blossom..."
  DOCKER_STARTED=1
  docker compose up -d relay blossom

  wait_for_service "Nostr relay" "http://localhost:${ANCHR_RELAY_PORT}" 15 || return 2
  wait_for_service "Blossom"     "$BLOSSOM_URL" 15 || return 2

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

  wait_for_service "Cashu mint" "${CASHU_MINT_URL}/v1/info" 20 || return 2
  pass "cashu mint"
}

run_docker_tests() {
  step "Phase 2: E2E Tests (relay + blossom)"

  NOSTR_RELAYS="$RELAY_URL" \
  NOSTR_RELAY_URL="$RELAY_URL" \
  BLOSSOM_SERVERS="$BLOSSOM_URL" \
  run_test "relay e2e" deno task test:e2e:relay

  step "Phase 3: Regtest Tests (HTLC + Cashu)"

  CASHU_MINT_URL="$CASHU_MINT_URL" \
  NOSTR_RELAYS="$RELAY_URL" \
  NOSTR_RELAY_URL="$RELAY_URL" \
  BLOSSOM_SERVERS="$BLOSSOM_URL" \
  run_test "regtest e2e" deno task test:e2e:regtest

  # TLSN bucket — boots its own verifier service and builds the local
  # prover/verifier binaries first so this path cannot pass by skipping all
  # proof-producing tests.
  step "Phase 4: TLSNotary E2E"
  echo "  Building tlsn-prover..."
  if ! (cd crates/tlsn-prover && cargo build 2>&1); then
    fail "tlsn-prover build"
    return
  fi
  echo "  Building tlsn-verifier..."
  if ! (cd crates/tlsn-verifier && cargo build --release 2>&1); then
    fail "tlsn-verifier build"
    return
  fi
  echo "  Starting tlsn-verifier..."
  if ! docker compose up -d tlsn-verifier 2>&1; then
    fail "tlsn-verifier start"
    return
  fi
  wait_for_tcp_service "TLSN verifier TCP" "localhost" "$ANCHR_TLSN_TCP_PORT" 30 || { fail "tlsn-verifier TCP readiness"; return; }
  wait_for_tcp_service "TLSN verifier WS"  "localhost" "$ANCHR_TLSN_WS_PORT" 30 || { fail "tlsn-verifier WS readiness"; return; }

  TLSN_E2E_REQUIRE_CORE=1 \
  TLSN_VERIFIER_HOST="$TLSN_VERIFIER_HOST" \
  TLSN_VERIFIER_WS_PORT="$ANCHR_TLSN_WS_PORT" \
  run_test "tlsn e2e" deno task test:e2e:tlsn
}

# --- Main ---

case "$MODE" in
  --local)
    run_local
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

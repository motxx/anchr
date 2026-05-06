#!/usr/bin/env bash
# Shared Docker Compose environment for local tests.
#
# Source this before invoking `docker compose`. By default it keeps plain
# `docker compose up` compatible. Set ANCHR_DOCKER_ISOLATION=worktree in test
# runners to derive an isolated project name and host port block from the
# current worktree path.

if [ -n "${ANCHR_DOCKER_COMPOSE_ENV_LOADED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
ANCHR_DOCKER_COMPOSE_ENV_LOADED=1

anchr_compose_sanitize() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

if [ "${ANCHR_DOCKER_ISOLATION:-}" = "worktree" ]; then
  ANCHR_WORKTREE_ROOT="${ANCHR_WORKTREE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  ANCHR_WORKTREE_NAME="$(anchr_compose_sanitize "$(basename "$ANCHR_WORKTREE_ROOT")")"
  ANCHR_WORKTREE_NAME="${ANCHR_WORKTREE_NAME:-worktree}"
  ANCHR_WORKTREE_NAME="${ANCHR_WORKTREE_NAME:0:24}"

  ANCHR_WORKTREE_HASH="$(printf '%s' "$ANCHR_WORKTREE_ROOT" | cksum | awk '{print $1}')"
  ANCHR_WORKTREE_HASH_SHORT="$((ANCHR_WORKTREE_HASH % 100000))"
  ANCHR_WORKTREE_PORT_OFFSET="$((ANCHR_WORKTREE_HASH % 1000))"

  : "${ANCHR_COMPOSE_PROJECT_NAME:=${COMPOSE_PROJECT_NAME:-anchr-${ANCHR_WORKTREE_NAME}-${ANCHR_WORKTREE_HASH_SHORT}}}"
  : "${ANCHR_RELAY_PORT:=$((17000 + ANCHR_WORKTREE_PORT_OFFSET))}"
  : "${ANCHR_BLOSSOM_PORT:=$((18000 + ANCHR_WORKTREE_PORT_OFFSET))}"
  : "${ANCHR_CASHU_MINT_PORT:=$((19000 + ANCHR_WORKTREE_PORT_OFFSET))}"
  : "${ANCHR_LND_REST_PORT:=$((20000 + ANCHR_WORKTREE_PORT_OFFSET))}"
  : "${ANCHR_LND_GRPC_PORT:=$((21000 + ANCHR_WORKTREE_PORT_OFFSET))}"
  : "${ANCHR_TLSN_TCP_PORT:=$((22000 + ANCHR_WORKTREE_PORT_OFFSET))}"
  : "${ANCHR_TLSN_WS_PORT:=$((23000 + ANCHR_WORKTREE_PORT_OFFSET))}"
  : "${ANCHR_HTTP_API_PORT:=$((24000 + ANCHR_WORKTREE_PORT_OFFSET))}"
else
  : "${ANCHR_COMPOSE_PROJECT_NAME:=${COMPOSE_PROJECT_NAME:-anchr}}"
  : "${ANCHR_RELAY_PORT:=7777}"
  : "${ANCHR_BLOSSOM_PORT:=3333}"
  : "${ANCHR_CASHU_MINT_PORT:=3338}"
  : "${ANCHR_LND_REST_PORT:=8081}"
  : "${ANCHR_LND_GRPC_PORT:=10009}"
  : "${ANCHR_TLSN_TCP_PORT:=7046}"
  : "${ANCHR_TLSN_WS_PORT:=7047}"
  : "${ANCHR_HTTP_API_PORT:=3000}"
fi

export ANCHR_COMPOSE_PROJECT_NAME
export COMPOSE_PROJECT_NAME="$ANCHR_COMPOSE_PROJECT_NAME"
export ANCHR_RELAY_PORT
export ANCHR_BLOSSOM_PORT
export ANCHR_CASHU_MINT_PORT
export ANCHR_LND_REST_PORT
export ANCHR_LND_GRPC_PORT
export ANCHR_TLSN_TCP_PORT
export ANCHR_TLSN_WS_PORT
export ANCHR_HTTP_API_PORT

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_PROJECT_NAME"
  printf 'ANCHR_DOCKER_ISOLATION=%s\n' "${ANCHR_DOCKER_ISOLATION:-shared}"
  printf 'ANCHR_RELAY_PORT=%s\n' "$ANCHR_RELAY_PORT"
  printf 'ANCHR_BLOSSOM_PORT=%s\n' "$ANCHR_BLOSSOM_PORT"
  printf 'ANCHR_CASHU_MINT_PORT=%s\n' "$ANCHR_CASHU_MINT_PORT"
  printf 'ANCHR_LND_REST_PORT=%s\n' "$ANCHR_LND_REST_PORT"
  printf 'ANCHR_LND_GRPC_PORT=%s\n' "$ANCHR_LND_GRPC_PORT"
  printf 'ANCHR_TLSN_TCP_PORT=%s\n' "$ANCHR_TLSN_TCP_PORT"
  printf 'ANCHR_TLSN_WS_PORT=%s\n' "$ANCHR_TLSN_WS_PORT"
  printf 'ANCHR_HTTP_API_PORT=%s\n' "$ANCHR_HTTP_API_PORT"
fi

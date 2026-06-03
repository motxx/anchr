#!/bin/bash
# Deploy Anchr infrastructure services to Fly.io.
# Usage: ./scripts/deploy.sh [all|relay|blossom|verifier]

set -e
TARGET=${1:-all}
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

deploy_relay() {
  echo "=== Deploying Nostr Relay ==="
  fly deploy --config fly.relay.toml
}

deploy_blossom() {
  echo "=== Deploying Blossom Server ==="
  fly deploy --config fly.blossom.toml
}

deploy_verifier() {
  echo "=== Deploying TLSNotary Verifier Server ==="
  cd crates/tlsn-server
  fly deploy --config fly.toml
  cd "$ROOT"
}

case "$TARGET" in
  all)
    deploy_relay
    deploy_blossom
    deploy_verifier
    ;;
  relay)     deploy_relay ;;
  blossom)   deploy_blossom ;;
  verifier)  deploy_verifier ;;
  *)
    echo "Usage: $0 [all|relay|blossom|verifier]"
    exit 1
    ;;
esac

echo "=== Deploy complete ==="
echo "Relay:          https://anchr-relay.fly.dev"
echo "Blossom:        https://anchr-blossom.fly.dev"
echo "Verifier:       https://anchr-tlsn-verifier.fly.dev"

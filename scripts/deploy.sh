#!/bin/bash
# Deploy all Anchr services to fly.io
# Usage: ./scripts/deploy.sh [all|app|verifier|provider]

set -e
TARGET=${1:-all}
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

deploy_verifier() {
  echo "=== Deploying TLSNotary Verifier Server ==="
  cd crates/tlsn-server
  fly deploy --config fly.toml
  cd "$ROOT"
}

deploy_app() {
  echo "=== Deploying Anchr App ==="
  fly deploy --config fly.toml
}

deploy_provider() {
  echo "=== Deploying Auto-Provider ==="
  fly deploy --config fly.provider.toml
}

case "$TARGET" in
  all)
    deploy_verifier
    deploy_app
    deploy_provider
    ;;
  verifier)  deploy_verifier ;;
  app)       deploy_app ;;
  provider)  deploy_provider ;;
  *)
    echo "Usage: $0 [all|app|verifier|provider]"
    exit 1
    ;;
esac

echo "=== Deploy complete ==="
echo "Anchr App:      https://anchr-app.fly.dev"
echo "Verifier:       https://anchr-tlsn-verifier.fly.dev"
echo "Provider:       anchr-tlsn-provider (background process)"

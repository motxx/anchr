#!/usr/bin/env bash
set -euo pipefail

if ! command -v cargo-audit > /dev/null 2>&1; then
  echo "ERROR: cargo-audit is not installed. Run: cargo install cargo-audit" >&2
  exit 1
fi

for crate in \
  crates/frost-signer \
  crates/tlsn-prover \
  crates/tlsn-server \
  crates/tlsn-verifier
do
  echo "Auditing $crate..."
  (
    cd "$crate"
    # Accepted advisory ignores:
    # - RUSTSEC-2023-0089: atomic-polyfill is pulled transitively through
    #   frost-core -> postcard -> heapless; no direct replacement is available
    #   without an upstream FROST dependency update.
    # - RUSTSEC-2026-0097: rand 0.8 is still required by the FROST/k256-facing
    #   RNG APIs used here. Keep all other advisory warnings gating.
    # - RUSTSEC-2025-0141, RUSTSEC-2024-0388, RUSTSEC-2024-0436, and
    #   RUSTSEC-2025-0134 are TLSNotary alpha transitive maintenance
    #   advisories. These stay visible here while vulnerability advisories
    #   such as rustls-webpki remain gating.
    cargo audit --deny warnings \
      --ignore RUSTSEC-2023-0089 \
      --ignore RUSTSEC-2026-0097 \
      --ignore RUSTSEC-2025-0141 \
      --ignore RUSTSEC-2024-0388 \
      --ignore RUSTSEC-2024-0436 \
      --ignore RUSTSEC-2025-0134
  )
done

echo "Cargo audit complete."

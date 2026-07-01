# Stop passing frost-signer secrets via argv and zeroize key material

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`frost-signer` accepts private key material (secret packages, key package,
nonces) as command-line arguments and never wipes in-memory secrets. CLI args
are visible to any local process via `ps` / `/proc/<pid>/cmdline` and land in
shell history, so a threshold-signing release authority can leak a signing
share or DKG secret to any co-resident process.

## Rationale

- `crates/frost-signer/src/main.rs`: `--secret-package`,
  `--round2-secret-package`, `--key-package`, `--nonces` read secrets from
  argv (~lines 31-70); secret bytes are serialized to stdout as plaintext JSON
  (~lines 171-174, 253-261, 297-302). No crate depends on `zeroize`.
- Related plaintext key copies: `tlsn-prover` (~line 273), `tlsn-server`
  (~line 559).

## Acceptance

- Secret inputs are read from stdin/file/fd rather than argv.
- Key material is wrapped in `Zeroizing` (or equivalent) so buffers are wiped
  on drop.

## Verification

- `rg` shows no secret-bearing `--flag <value>` argv paths in
  `crates/frost-signer/src/main.rs`.
- Manual: `ps`/`/proc` for a running signer does not expose key bytes.

## Plan

- Switch secret inputs to stdin/file/fd.
- Add `zeroize` and wrap share/nonce/DKG buffers.

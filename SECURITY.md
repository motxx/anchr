# Security Policy

## Supported Versions

Anchr is experimental and testnet-only. Security fixes target the current `main`
branch until stable releases begin.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Report security issues by email to `security@anchr.dev` with:

- Affected package, crate, example, or deployment file.
- Reproduction steps or proof-of-concept input.
- Expected impact, including whether funds, proofs, keys, or private data can be
  exposed or moved.
- Any relevant logs, commit hashes, or environment details.

You should receive an acknowledgement within 72 hours. If the report is valid,
the fix will be developed privately when needed, then disclosed with credit
unless you ask to remain anonymous.

## Scope

In scope:

- Cashu HTLC and conditional-swap logic.
- Oracle verification and preimage or FROST-signature release paths.
- TLSNotary, C2PA, ProofMode, attachment, Nostr, and MCP handling.
- CI, release, dependency, and container supply-chain issues.

Out of scope:

- Mainnet fund loss from experimental deployments.
- Third-party Cashu mints, Nostr relays, TLSNotary notaries, or Blossom hosts
  not operated by this project.
- Denial of service from public test infrastructure rate limits.

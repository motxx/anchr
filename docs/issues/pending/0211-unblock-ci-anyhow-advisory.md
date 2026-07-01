# Unblock CI: resolve the anyhow RUSTSEC advisory and clear the dep-bump backlog

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

PR CI is currently red at the `dep audit` step — `cargo-audit` denies a RUSTSEC
advisory ("Unsoundness in `Error::downcast_mut()`", an `anyhow` advisory) as a
denied warning. The fix is the pending `anyhow 1.0.103` dependabot bumps, but
those PRs cannot go green because they hit the same red gate, and a backlog of
~15 open dependabot PRs (oldest from early June) has accumulated behind it.

## Rationale

- Failed CI `dep audit`: "1 denied warning found!" for the anyhow advisory
  (observed on the open `uuid` and codeql-action dependabot PRs).
- Pending anyhow bumps: PRs for `crates/tlsn-server`, `crates/tlsn-prover`,
  `crates/tlsn-verifier` (`anyhow 1.0.103`).
- `scripts/cargo-audit-all.sh` (fails closed, documents each ignore).
- Per-crate manifests fan each shared-dep bump into 3-4 PRs (see 0212).

## Acceptance

- Main and PR CI are green: the anyhow advisory is resolved (bump merged across
  all crates that use it, or a justified, documented advisory ignore added).
- The open dependabot backlog is triaged (merged in batch or closed with
  reason), consistent with the repo's batch-auto-merge bias.

## Verification

- `gh run list --branch main --workflow CI --limit 1` shows success.
- `deno task lint:deps` (cargo audit) passes locally.

## Plan

- Land the anyhow bump across all four crates (or add a documented ignore with
  rationale), then clear the dependabot queue in a batch.

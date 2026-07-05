# Unblock CI: resolve the anyhow RUSTSEC advisory and clear the dep-bump backlog

Created: 2026-07-02
Model: Claude Fable 5
Completed: 2026-07-02

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

## Resolution

Implemented by updating:

- `crates/*/Cargo.lock` (PR #204) — `anyhow` 1.0.103 in all four crates
  (dependabot had missed `frost-signer`), plus `quinn-proto` 0.11.15 for
  RUSTSEC-2026-0185, a second advisory published 2026-06-22 that would have
  re-redded CI immediately after the anyhow fix alone. PR #207 (issue 0220)
  then removed the unused `reqwest`→`quinn` tree entirely.
- Dependabot backlog cleared: #197/#198/#200 (anyhow) auto-closed as
  superseded by #204; #181 (tower-http) and #165 (hyper) auto-closed after
  #207 deleted those dependencies; #172 consolidated into #201 by dependabot;
  the remaining nine (#202, #167, #168, #166, #201, #199, #196, #163, #177)
  were rebased onto the fixed main and batch squash-merged on green CI.

Verified with:

- `gh run list --branch main --workflow CI --limit 1` — success (run
  28586379579 after #207, re-verified on the post-triage merge run).
- `deno task lint:deps` — cargo audit passes across all four crates.

Harness update:

- The gating `scripts/cargo-audit-all.sh` (fail-closed, documented ignores)
  already owns advisory detection; the new `cargo machete` Rust-gate step
  (issue 0220) shrinks the advisory surface. The deadlock pattern this issue
  hit — per-crate manifests fanning one advisory into several mutually-red
  PRs — is absorbed structurally by pending issue 0212 (single Cargo
  workspace, one lockfile, one bump PR).

Review residuals:

- Major action bumps merged on green CI during the triage (actions/checkout
  v7, gitleaks-action v3); their behavior is visible on subsequent main
  workflow runs. No other maintainer decision remains.

Follow-up:

- None

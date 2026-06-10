# Restore green main CI

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`main` CI has not been green since 2026-05-25. Two stacked causes:

1. Since 2026-05-31 every run fails fast at `lint:deps`: the runner has no
   `cargo-audit` binary (`ERROR: cargo-audit is not installed`), so
   `scripts/test-all.sh` marks `dep audit` FAIL.
2. Before that (2026-05-26 to 2026-05-31) runs died as `cancelled` at the
   25-minute job timeout (#0100 captured this symptom).

## Rationale

- Failed run `27275871313` (2026-06-10, main) and `27275...` (2026-05-31)
  both log `ERROR: cargo-audit is not installed. Run: cargo install cargo-audit`.
- `deno task lint:deps` → `scripts/cargo-audit-all.sh` requires the binary;
  CI never installs it. Skipping the audit on missing binary would be a
  silent security-check bypass, so the fix is installation, not a guard.

## Acceptance

- A fresh `main` CI run concludes `success` with the `dep audit` step passing
  a real `cargo audit` over all four crates.
- The job timeout accommodates the full consolidated pipeline (local +
  Docker phases) with cold caches.

## Verification

- `gh run view <run-id> --json conclusion` reports `success` for a post-fix
  `main` run.
- The run log shows `Auditing crates/...` output from cargo-audit.

## Plan

- Install cargo-audit in `.github/workflows/ci.yml` via a SHA-pinned
  `taiki-e/install-action` step before `deno task test:all`.
- Raise `timeout-minutes` to cover the consolidated pipeline.

## Resolution

Implemented by updating:

- `.github/workflows/ci.yml` — install cargo-audit via SHA-pinned
  `taiki-e/install-action@fd2f5e3d644b484055ebf4268f474c565f148f25` (v2.81.9)
  before the test pipeline; `timeout-minutes` raised 25 → 45 for the
  consolidated local+Docker pipeline.

Verified with:

- `gh run view 27276572266 --json conclusion` → `success` (main, commit
  `ac264a1`): the first green main CI since 2026-05-25, with the `dep audit`
  step running real `cargo audit` over all four crates.

Harness update:

- None — the failing check itself (lint:deps in CI) is the harness; the fix
  restores its execution environment.

Review residuals:

- None

Follow-up:

- None

# Restructure CI: paths-gate slow jobs and decouple deploy from flaky e2e

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

`ci.yml` triggers on all PRs with no `paths` filter and runs the full Rust gate
plus the Docker-backed regtest/TLSN e2e unconditionally, so a workflow- or
action-only dependabot bump is gated on a known-flaky Lightning-regtest e2e it
cannot affect (a likely cause of the CodeQL-action bump failure). Production
deploys key off CI success, coupling release cadence to the least reliable
gate. A blind `sleep`+restart of the Cashu mint adds to the flakiness.

## Rationale

- `.github/workflows/ci.yml` (~lines 3-7 trigger; ~79-87 run `test:all` +
  `test:all:docker`).
- `scripts/test-all.sh` (~145-152) documents the regtest LND "classic flake";
  (~180-184) `docker compose restart cashu-mint 2>/dev/null || true`.
- `deploy.yml` / `deploy-proof-schema-site.yml` gate on
  `workflow_run: CI … conclusion == 'success'`.
- Also align the local infra bring-up docs: `CONTRIBUTING.md` (~102-104) uses
  the shared `anchr` compose project/ports while `test:all:docker` sources
  `scripts/docker-compose-env.sh` worktree isolation — document that the two
  paths are exclusive.

## Acceptance

- Slow Rust + Docker e2e jobs are gated behind `paths:` (`packages/**`,
  `crates/**`, `e2e/**`, compose files, lockfiles); workflow-only and
  Markdown-only changes take a lightweight path.
- Deploy keys off a stable build/test gate, not the flaky Docker e2e (moved to a
  separate non-blocking or auto-retried job).
- The mint bring-up is health-gated rather than blind `sleep`+restart, and the
  two local infra paths are documented as exclusive.

## Verification

- A workflow-only dependabot PR does not trigger the Docker e2e.
- A transient e2e flake on `main` does not block deploy.

## Plan

- Split fast/slow jobs with `paths:`; move Docker e2e off the deploy-gating
  path; health-gate the mint start; update `CONTRIBUTING.md`.

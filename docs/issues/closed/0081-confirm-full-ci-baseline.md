# Confirm full CI baseline

Created: 2026-05-27
Model: GPT-5 Codex
Completed: 2026-05-30

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0080
- 0086

## Summary

Confirm that the repository has a clean full verification baseline before broad
public-release cleanup starts. Deleting docs, skills, examples, scripts, and
stale entry points should happen from a known-good state so later failures can
be attributed to the cleanup change that introduced them.

## Rationale

The intended cleanup includes dead-code removal, directory pruning, and public
surface reshaping. Those changes have broad blast radius. Running and recording
the full local and CI baseline first prevents cleanup work from hiding existing
test, Docker, network, or GitHub Actions failures.

## Acceptance

- `deno task test:all` passes locally.
- `deno task test:all:docker` passes locally, or any environment-only failure
  is recorded with the exact failing phase and log summary.
- Current GitHub Actions for the target branch is green, or any red job has a
  concrete blocker recorded before cleanup continues.
- The baseline result is recorded in this issue's resolution note.

## Verification

- `deno task test:all`
- `deno task test:all:docker`
- `gh run list --limit 5`
- `gh run view <run-id> --log-failed`

## Plan

- Run the local full suite.
- Run the Docker-backed suite.
- Check the latest remote CI run for the branch that will be published.
- Record any blocker instead of continuing broad cleanup on a red baseline.

## Resolution

Implemented by updating:
- `docs/issues/closed/0081-confirm-full-ci-baseline.md`
- `docs/issues/pending/0080-prepare-public-release-cleanup.md`
- `docs/issues/pending/0085-finalize-public-repository-layout.md`
- `docs/issues/pending/0086-audit-protocol-conformance.md`

Baseline result:
- `deno task test:all` passed when run outside the filesystem sandbox. The
  normal sandboxed run failed only in `lint:deps` because `cargo audit` could
  not lock its advisory database on a read-only path; the
  escalated full run completed with lint, dependency audit, unit, integration,
  protocol e2e, scripts, examples, and FROST e2e all passing.
- `deno task test:all:docker` reached the Docker-backed relay, Blossom,
  regtest Lightning, Cashu, protocol/regtest, and TLSN verifier setup phases.
  It failed in `test:e2e:tlsn` while generating real TLSNotary presentations:
  the prover connected to the local verifier, then failed DNS lookup for
  `api.bitflyer.com:443/v1/ticker?product_code=BTC_JPY` with
  `failed to lookup address information: nodename nor servname provided, or not
  known`. This is recorded as an environment-only external DNS/network blocker,
  not a local service startup or protocol/regtest failure.
- `gh run list --limit 5` showed the latest visible runs on `main`: deploy
  workflows skipped and Supply Chain Security green. `gh run list --branch
  docs/restruct-docs --limit 5` returned no runs for this local branch.
- `gh run view 26463761049 --log-failed` for the latest `main` CI cancellation
  returned no failed-job log output. `gh run view 26463761049` reported that
  the CI job exceeded the 25 minute maximum execution time, then the operation
  was canceled.

Verified with:
- `deno task test:all` (sandboxed run documents Cargo advisory lock failure;
  escalated run passed)
- `deno task test:all:docker` (environment-only DNS failure recorded above)
- `gh run list --limit 5`
- `gh run list --branch docs/restruct-docs --limit 5`
- `gh run view 26463761049 --log-failed`
- `gh run view 26463761049`

Harness update:
- None. This issue records the current verification baseline; no recurring
  review class required a new harness.

Review residuals:
- Docker TLSNotary E2E still depends on resolving `api.bitflyer.com` from the
  local test environment.
- The local branch has no current GitHub Actions run; the latest visible
  successful verification is the `main` Supply Chain Security run. The latest
  visible `main` CI run timed out after 25 minutes.

Follow-up:
- None.

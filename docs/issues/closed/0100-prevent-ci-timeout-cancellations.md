# Prevent CI timeout cancellations

Created: 2026-06-01
Model: Codex (GPT-5)
Completed: 2026-06-10

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

CI runs are completing as `cancelled` even after the verification steps pass.
The current `CI` job has a 25 minute job-level timeout, and recent runs reached
that limit while the final Docker deploy image build was running. This makes a
green verification path appear cancelled and blocks reliable branch health.

## Rationale

Relevant workflow:

- `.github/workflows/ci.yml` sets `timeout-minutes: 25` on the single `CI` job.
- The final `Build deploy image` step runs after local tests, Docker-backed
  relay/regtest/TLSN tests, and infrastructure cleanup.

Observed runs:

- `26718341904` on `docs/restruct-docs` started at `2026-05-31T16:39:52Z` and
  was cancelled at `2026-05-31T17:05:10Z`; all verification steps before
  `Build deploy image` succeeded.
- `26718397415` on `main` started at `2026-05-31T16:42:12Z` and was cancelled
  at `2026-05-31T17:07:31Z`; the same final step was cancelled.

The workflow also uses `concurrency.cancel-in-progress`, but these runs line up
with the 25 minute job timeout rather than a newer same-ref run cancelling the
older run.

## Acceptance

- A CI run where all verification steps pass no longer ends with conclusion
  `cancelled` because the deploy image build starts near the job timeout.
- The workflow clearly accounts for the Docker image build duration, either by
  increasing the relevant timeout budget or by moving/splitting that work into a
  separately bounded responsibility.
- The chosen workflow shape preserves the existing verification coverage.

## Verification

- Trigger or observe a fresh `CI` run for the updated workflow and confirm
  `gh run view <run-id> --json conclusion,jobs` reports `conclusion: success`.
- Confirm the final job/step list no longer shows `Build deploy image` as the
  only cancelled step after earlier verification steps succeeded.

## Plan

- Re-read `.github/workflows/ci.yml` and recent CI durations before editing.
- Choose the smallest workflow change that makes CI completion reflect the
  verification result without hiding a real Docker build failure.
- Run or inspect a fresh GitHub Actions run and record the result when closing
  this issue.

## Resolution

Implemented by updating:

- `.github/workflows/ci.yml` — the `Build deploy image` step no longer exists
  in the CI job (image builds are owned by `deploy.yml` via `workflow_run`
  after CI succeeds on main); the Docker e2e phases run through
  `deno task test:all:docker` in one bounded step; `timeout-minutes` is 45,
  sized for the consolidated pipeline with cold caches.

Verified with:

- `gh run view 27276572266 --json conclusion,jobs` → `conclusion: success`
  on main; no step ends `cancelled`, and the job list contains no deploy
  image build.

Harness update:

- None — workflow-shape fix; CI conclusion now reflects the verification
  result (#0114 restored the green baseline).

Review residuals:

- None

Follow-up:

- None

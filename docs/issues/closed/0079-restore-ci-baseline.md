# Restore CI baseline

Created: 2026-05-25
Model: GPT-5 Codex
Completed: 2026-05-25

## Priority

investigation

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Investigate the current CI failure, identify the root cause, and restore a
green baseline before continuing broad code-changing pending issues. The
repository expects issue resolution to finish with the full local verification
suite for non-docs-only changes, so a failing CI baseline makes subsequent
issue closure ambiguous.

This issue should determine whether the failure is caused by local tests,
GitHub Actions configuration, Docker-backed e2e infrastructure, environment
assumptions, or a recent repository change. Fix the smallest root cause that
returns CI to green, or split follow-up issues if the failure spans independent
systems.

## Rationale

The main CI workflow runs `deno task test:all` and separate Docker-backed e2e
jobs from `.github/workflows/ci.yml`. `CLAUDE.md` documents `deno task test:all`
as the local full suite for non-Docker verification and `deno task
test:all:docker` for Docker-backed e2e coverage.

Upcoming pending issues include SDK boundary changes, vocabulary migrations,
Nostr payload changes, payment ownership changes, and e2e/doc updates. Those
issues will be easier and safer to close after CI has a known-good baseline.

## Acceptance

- The failing CI job and command are identified from the current workflow run or
  an equivalent local reproduction.
- The root cause is fixed, or the issue is split into narrower child issues if
  one coherent fix cannot restore the baseline.
- The repository has a green non-Docker baseline for `deno task test:all`.
- If Docker-backed CI jobs are part of the failure, their local or CI
  reproduction path is documented and either fixed or split into a focused
  follow-up.
- No unrelated pending issue implementation is bundled into the CI baseline fix.

## Verification

- `deno task test:all`
- If the failing CI job is Docker-backed: `deno task test:all:docker` or the
  narrower failing Docker-backed task from `.github/workflows/ci.yml`
- Current GitHub Actions CI run is green, or any remaining red job is tracked by
  a new pending issue with the exact failing command and blocker.

## Plan

- Inspect the latest failing GitHub Actions run and identify the failing job,
  command, and first root-cause error.
- Reproduce the failure locally with the narrowest matching command before
  editing code or workflow files.
- Fix the root cause with the smallest coherent change.
- Run `deno task test:all`, then verify the affected CI job path.

## Resolution

Implemented by updating:

- No new implementation changes were needed in this queue run.
- Current local `main` already contains the cleanup commits after failing CI
  head `0440a94`, including stale script removals and relay/e2e import updates.

Verified with:

- `gh run view 26337481760 --json jobs,conclusion,status,url,headSha,createdAt`
- `gh run view 26337481760 --log-failed`
- `deno task check`
- `deno task test:all`

Harness update:

- None - this was a baseline investigation; existing `deno task check` and
  `deno task test:all` are the harnesses that caught and verify the class of
  failure.

Review residuals:

- GitHub Actions has not run for local `ffdfc6b` because this branch is ahead of
  `origin/main`; the old red CI run is for `0440a94`.

Follow-up:

- None

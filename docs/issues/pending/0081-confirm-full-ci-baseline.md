# Confirm full CI baseline

Created: 2026-05-27
Model: GPT-5 Codex

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

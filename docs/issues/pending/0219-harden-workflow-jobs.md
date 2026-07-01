# Harden workflow jobs: add timeouts and egress-block on secret-handling jobs

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

Two workflow-hardening gaps: four workflows set no `timeout-minutes`, so a hung
Claude action, a stuck `deno publish`, or a stalled Scorecard run can burn up to
the 6-hour default; and `harden-runner` runs `egress-policy: audit` (log-only)
everywhere, including the publish/deploy jobs that handle `NPM_TOKEN` /
`FLY_API_TOKEN_*` / id-token, so a compromised dependency could still exfiltrate
from the most sensitive jobs.

## Rationale

- No `timeout-minutes` in `.github/workflows/claude.yml`,
  `claude-code-review.yml`, `publish.yml` (3 jobs), `supply-chain.yml` (3 jobs).
- `harden-runner` egress `audit` on every workflow (e.g. `ci.yml` ~24-27,
  `publish.yml` ~26-29, `deploy.yml` ~49-52).

## Acceptance

- Every job across those workflows sets a modest `timeout-minutes`.
- `publish.yml` and `deploy.yml` (and ideally `ci.yml`) use
  `egress-policy: block` with an explicit allowlist derived from the audit logs.

## Verification

- `rg "timeout-minutes" .github/workflows` shows a value in every job.
- The publish/deploy workflows set `egress-policy: block`.

## Plan

- Add `timeout-minutes` to each job; establish the egress allowlist from audit
  logs, then switch the secret-handling workflows to `block`.

# Add example smoke harness

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0025
- 0027
- 0028

## Summary

Define the shared smoke-test and runbook convention for README-listed Testnet
examples so each example has a consistent completion bar.

This should avoid each example inventing a different meaning for "runnable" or
"Testnet".

## Rationale

`0025` requires documented setup, environment, local stack, and smoke-test
commands for multiple examples. A shared convention keeps the two Testnet
example issues small and makes future example status changes easier to review.

Relevant files:

- `README.md`
- `docs/review-harness.md`
- `example/*/README.md`
- `example/*/deno.json`

## Plan

- Define what a README-listed Testnet example must provide: config template,
  command sequence, local service assumptions, and smoke command.
- Decide whether the convention belongs in the top-level README, a new example
  guide, or `docs/review-harness.md`.
- Add or update `deno task` naming conventions for example smoke checks where
  practical.
- Document how maintainers should verify an example before marking it Testnet
  or complete.

## Resolution

Implemented by updating:

- `docs/review-harness.md`
- `deno.json`
- `example/c2pa-media-verification/deno.json`
- `example/c2pa-media-verification/README.md`
- `example/c2pa-media-verification/RUNBOOK.md`
- `example/tlsn-fiat-swap-square/deno.json`
- `example/tlsn-fiat-swap-square/README.md`
- `example/tlsn-fiat-swap-square/RUNBOOK.md`

Verified with:

- `deno task smoke` from `example/c2pa-media-verification/`
- `deno task smoke` from `example/tlsn-fiat-swap-square/`
- `deno task lint:fmt`
- `deno task lint:arch`
- `deno task lint:strict`
- `deno task test:examples`
- `deno task test:all` (all local lint/tests passed except sandbox-blocked
  dependency audit)
- `deno task lint:deps` (rerun outside sandbox after the advisory DB lock was
  blocked under the sandbox)

Harness update:

- `docs/review-harness.md` now defines the Testnet example smoke convention,
  required runbook contents, task naming, and maintainer verification flow.
- `deno task smoke` is now present for both README-listed Testnet examples.

Review residuals:

- None.

Follow-up:

- 0027 and 0028 can now use the shared smoke/runbook convention to finish each
  Testnet example's reproducibility work.

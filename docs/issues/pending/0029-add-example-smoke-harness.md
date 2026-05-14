# Add example smoke harness

Created: 2026-05-15
Model: Codex (GPT-5)

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

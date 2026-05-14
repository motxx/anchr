# Settle airdrop shield target

Created: 2026-05-15
Model: Codex (GPT-5)

## Priority

design

## Dependencies

Depends on:
- 0030

Blocks:
- 0026

## Summary

Decide and implement the completion target for
`example/airdrop-bot-shield/`, which is currently listed as `Simulation` in the
top-level README.

The outcome should either graduate it toward a runnable verification service
example or clearly document it as an intentional simulation.

## Rationale

`example/airdrop-bot-shield/` demonstrates a verification-only attestation
flow, but its README status does not define what readers can run or rely on.
This issue owns the example-specific decision and follow-through after the
shared status vocabulary is defined.

Relevant files:

- `README.md`
- `example/airdrop-bot-shield/README.md`
- `example/airdrop-bot-shield/`

## Plan

- Audit the example's current service, README, and tests.
- Decide whether `airdrop-bot-shield` should become runnable or remain a
  simulation.
- If runnable, add missing non-secret config docs, commands, and smoke coverage.
- If simulation-only, make the README explicit about the simulated boundary and
  what future issue would be needed to graduate it.
- Update the top-level README status to match the chosen target.

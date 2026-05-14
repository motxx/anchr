# Finish concept simulation examples

Created: 2026-05-15
Model: Codex (GPT-5)

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Decide and implement the completion target for README-listed examples that are
not currently marked Testnet or Implemented:

- `example/auto-claim/` (`Concept`)
- `example/airdrop-bot-shield/` (`Simulation`)

Either graduate them into runnable examples with documented flows, or make the
README and example READMEs explicit that they are intentionally non-runnable
design sketches.

## Rationale

The README's "Reference Implementations" table lists these examples alongside
runnable examples. That is useful only if each status has a clear meaning and a
maintained acceptance bar.

Without that, readers cannot tell whether missing deployment wiring is work to
finish, an intentional limitation, or stale documentation.

Relevant files:

- `README.md`
- `example/auto-claim/README.md`
- `example/airdrop-bot-shield/README.md`
- `example/auto-claim/`
- `example/airdrop-bot-shield/`

## Plan

- Define the status vocabulary for `Concept`, `Simulation`, `Testnet`, and
  `Implemented` in README or a linked example guide.
- For `auto-claim`, decide whether the target is a runnable browser automation
  flow or a documented concept-only design.
- For `airdrop-bot-shield`, decide whether the target is a runnable
  verification service flow or a simulation-only proof gate.
- Add missing runbooks, env templates, and smoke tests for any example promoted
  beyond concept/simulation status.
- Update the top-level README status table to match the implemented target.

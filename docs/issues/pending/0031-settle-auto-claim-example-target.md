# Settle auto-claim example target

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

Decide and implement the completion target for `example/auto-claim/`, which is
currently listed as `Concept` in the top-level README.

The outcome should either graduate it toward a runnable browser automation
example or clearly document it as an intentional concept-only design.

## Rationale

`example/auto-claim/` demonstrates TLSNotary-based browser automation, but the
README status does not tell readers what is expected to work. This issue owns
the example-specific decision and follow-through after the shared status
vocabulary is defined.

Relevant files:

- `README.md`
- `example/auto-claim/README.md`
- `example/auto-claim/`

## Plan

- Audit the example's current scripts, README, and tests.
- Decide whether `auto-claim` should become runnable or remain concept-only.
- If runnable, add missing non-secret config docs, commands, and smoke coverage.
- If concept-only, make the README explicit about the intentional non-runnable
  boundary and what future issue would be needed to graduate it.
- Update the top-level README status to match the chosen target.

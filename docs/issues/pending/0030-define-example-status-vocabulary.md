# Define example status vocabulary

Created: 2026-05-15
Model: Codex (GPT-5)

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0026
- 0031
- 0032

## Summary

Define the meaning and acceptance bar for README example statuses such as
`Concept`, `Simulation`, `Testnet`, and `Implemented`.

The status vocabulary should make clear whether an example is expected to be
runnable, partially simulated, or intentionally design-only.

## Rationale

`README.md` lists examples with several status labels, but the labels are not
defined. That makes it hard to know whether missing deployment wiring is stale
documentation, future work, or an intentional product boundary.

Relevant files:

- `README.md`
- `docs/universality-boundaries.md`
- `docs/review-harness.md`
- `example/*/README.md`

## Plan

- Define each status label in one canonical doc location.
- State the minimum docs, config, and smoke-test expectations for each status.
- Update the top-level README table or nearby prose to link to the definition.
- Keep example-specific policy in `example/<app>/` and avoid promoting product
  choices into universal protocol docs.

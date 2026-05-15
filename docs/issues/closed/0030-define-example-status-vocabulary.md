# Define example status vocabulary

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

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

## Resolution

Implemented by updating:

- `docs/universality-boundaries.md`
- `README.md`

Verified with:

- `deno task lint:fmt`
- `deno task lint:paths`
- `deno task lint:no-history-comments`
- `deno task lint:strict`
- `deno task test:all` (all local lint/tests passed except sandbox-blocked
  dependency audit)
- `deno task lint:deps` (rerun outside sandbox after the advisory DB lock was
  blocked under the sandbox)

Harness update:

- `docs/universality-boundaries.md` now owns the human universal decision for
  README example status vocabulary; shared smoke harness details remain routed
  to `docs/review-harness.md` when they become repeatable across examples.

Review residuals:

- None.

Follow-up:

- 0031 and 0032 can now use the status vocabulary to settle the example-specific
  targets for `auto-claim` and `airdrop-bot-shield`.

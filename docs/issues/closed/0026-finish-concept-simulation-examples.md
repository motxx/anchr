# Finish concept simulation examples

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

## Priority

design

## Dependencies

Depends on:
- 0030
- 0031
- 0032

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

- Resolve 0030 to define the example status vocabulary.
- Resolve 0031 for the `auto-claim` completion target.
- Resolve 0032 for the `airdrop-bot-shield` completion target.
- Update the top-level README status table after the child issues settle the
  implemented targets.

## Resolution

Implemented by updating:

- `docs/universality-boundaries.md`
- `README.md`
- `example/auto-claim/README.md`
- `example/airdrop-bot-shield/README.md`
- `docs/issues/closed/0030-define-example-status-vocabulary.md`
- `docs/issues/closed/0031-settle-auto-claim-example-target.md`
- `docs/issues/closed/0032-settle-airdrop-shield-target.md`

Verified with:

- `deno task lint:fmt`
- `deno task lint:paths`
- `deno task lint:no-history-comments`
- `deno task lint:strict`
- `deno task test:all` (all local lint/tests passed except sandbox-blocked
  dependency audit)
- `deno task lint:deps` (rerun outside sandbox after the advisory DB lock was
  blocked under the sandbox)
- `deno check --config ../../deno.json agent.ts insurer.ts mock-airline.ts`
  from `example/auto-claim/`
- `deno task test` from `example/airdrop-bot-shield/`

Harness update:

- `docs/universality-boundaries.md` now owns the status vocabulary.
- `example/auto-claim/README.md` locks the `Concept` target and graduation bar.
- `example/airdrop-bot-shield/README.md` locks the `Implemented`
  operator-preview target, smoke command, and simulation-demo boundary.

Review residuals:

- None.

Follow-up:

- None.

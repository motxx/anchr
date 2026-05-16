# Define example delivery lifecycle

Created: 2026-05-15
Model: GPT-5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Define a repeatable lifecycle for taking an `example/<app>/` from requirements
definition to a completed, advertised repository example. The lifecycle should
make future example work explicit before implementation starts: what user flow
the example proves, which Anchr packages it may use, which dependencies are
real versus simulated, what completion status it targets, and what tests,
runbooks, or smoke checks prove that status.

## Rationale

`docs/universality-boundaries.md` now defines example status labels, and
`docs/review-harness.md` defines the maintenance loop for review findings. The
repository still lacks one concrete issue/checklist shape that guides a new
example from initial requirements through implementation, docs, verification,
README status updates, and issue closure.

Without that lifecycle, future example issues can skip the requirements stage or
advertise a status before the runbook and harness are in place. This issue is
about defining the reusable delivery process, not completing a specific example.

Relevant references:

- `docs/universality-boundaries.md`
- `docs/review-harness.md`
- `docs/issues/README.md`
- `example/c2pa-media-verification/README.md`
- `example/tlsn-fiat-swap-square/README.md`

## Plan

- Inventory the current example statuses and identify which fields are required
  before an example can move from concept or sketch to simulation, testnet, or
  implemented.
- Define a requirements section template for future example issues: target user
  flow, actors, proof/payment dependencies, data handled, non-production
  boundary, and out-of-scope production claims.
- Define a completion checklist covering code, docs, runbook, `.env.example`,
  smoke or e2e command, top-level README status, and closure notes.
- Document how future per-example issues should depend on this lifecycle and how
  to split follow-up implementation work when one issue would become too broad.

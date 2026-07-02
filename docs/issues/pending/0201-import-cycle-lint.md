# Add an automated import-cycle check to lint:strict

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

Issues 0168-0170 removed the three legacy import cycles and their resolutions
state that "lint:arch already forbids new import cycles," but `arch-lint.ts` has
no cycle check and `lint:strict` never runs `sprawlens`. Cycles are caught only
by a manual `sprawlens analyze`, so nothing in CI prevents a regression from
reintroducing one (verified: zero cycles today).

## Rationale

- `scripts/arch-lint.ts` has no SCC/cycle rule; `deno.json` `lint:strict` does
  not invoke `sprawlens`.
- The closed-issue claims (0168, 0170) are inaccurate on this point.

## Acceptance

- `lint:strict` fails when a package import cycle is introduced (an SCC check in
  `arch-lint.ts` or `sprawlens` wired into the chain).
- The inaccurate closed-issue claims are corrected or noted.

## Verification

- Introducing a deliberate cycle fails `deno task lint:strict`; the current
  tree passes.

## Plan

- Add an SCC check to `arch-lint.ts` or wire `sprawlens analyze` into
  `lint:strict`.

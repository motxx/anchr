# Enforce the unit tier's no-I/O contract with Deno permissions

Created: 2026-07-03
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The unit tier is documented as "No I/O", but `test:unit` grants
`--allow-env --allow-read --allow-write --allow-net --allow-run
--allow-sys` to every test it runs. The contract is enforced by convention
only: a unit test that opens sockets, writes files, or spawns processes
passes silently. Deno's permission model can enforce the tier directly —
drop `--allow-write`, `--allow-net`, and `--allow-run` from `test:unit`
(narrowing `--allow-read`/`--allow-env` where practical) so a violating
test fails loudly at the permission boundary.

## Rationale

- `deno.json` `test:unit` task: full permission set on the no-I/O tier.
- AGENTS.md test rules: unit tier = "No I/O".
- 0216 covers gate-marker integrity and `deno task test` drift; it does not
  touch tier permissions. 0189 removes sleeps but not I/O capability.
- The in-process Paid Request test is already assigned to the integration tier.

## Acceptance

- `test:unit` runs without write/net/run permissions (exceptions, if any
  are genuinely required, are narrowed per-path/per-host and justified in
  the task definition or resolution note).
- All unit tests pass under the tightened permissions.

## Verification

- `deno task test:unit` passes with the reduced permission set.
- A scratch test performing `fetch` or `Deno.writeTextFile` under the unit
  tier fails with a permission error (expected failure), demonstrating the
  gate.

## Plan

- Tighten the task flags; fix or re-tier any tests that surface as
  violators.

# Move packages/sdk/src/integration.test.ts into the tier its name claims

Created: 2026-07-03
Model: Claude Fable 5
Completed: 2026-08-30

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0235

## Summary

`packages/sdk/src/integration.test.ts` is a ~240-line in-process wiring
test (Customer + Provider + fake oracle over an in-memory relay) whose own
header matches the documented integration tier. But its basename does not
match the `*.integration.test.ts` suffix, so `test:unit`'s
`--ignore=**/*.integration.test.ts` does not exclude it and
`test:integration`'s `find -name "*.integration.test.ts"` does not collect
it — it silently runs in the unit tier. The integration tier currently
contains exactly one file (`oracle-service.integration.test.ts`). The tier
taxonomy ("one suffix per tier") has a hole exactly at the file named after
a tier.

## Rationale

- `packages/sdk/src/integration.test.ts:1-8` (self-description as
  in-process wiring test).
- `deno.json` `test:unit` (`--ignore=**/*.integration.test.ts`) and
  `test:integration` (find pattern) — both miss the bare name.
- AGENTS.md test rules: integration tier = `*.integration.test.ts`
  next to source, in-process transports only.
- 0189 fixes this file's sleeps but not its tier placement.

## Acceptance

- The file is renamed to a `<name>.integration.test.ts` form (e.g.
  `sdk-wiring.integration.test.ts`) or its content is redistributed;
  `test:unit` no longer executes it and `test:integration` does.

## Verification

- `deno task test:integration` lists and passes the renamed file.
- `deno task test:unit` passes and its output does not include the wiring
  test.

## Plan

- Rename the file; re-run both tiers.

## Resolution

Implemented by updating:

- `packages/sdk/src/integration.test.ts` to
  `packages/sdk/src/paid-request.integration.test.ts`
- `docs/issues/pending/0189-replace-wall-clock-sleeps-in-unit-tests.md`
- `docs/issues/pending/0235-enforce-unit-tier-no-io-permissions.md`

Verified with:

- `deno task test:integration`
- `deno task test:unit`
- `deno task check`
- `deno task test:all`

Harness update:

- None — the existing unit exclusion and integration discovery globs enforce
  the documented `*.integration.test.ts` tier once the file follows that
  convention.

Review residuals:

- None

Follow-up:

- 0235 is unblocked.

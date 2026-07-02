# Remove the INV-05 FROST threshold test escape hatch

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

The INV-05 (FROST threshold) test has an early `return` before its core
assertion: if `signRound2` returns non-ok for any reason the test exits before
ever checking that below-threshold aggregation fails, so a regression that lets
a 1-of-3 aggregate succeed could pass CI as long as round 2 happened to fail
first. The preceding negative `verifySignature` case is likewise conditional.

## Rationale

- `e2e/frost/frost-threshold.test.ts`: `if (!r2.ok) return;` (~line 381)
  precedes `expect(agg.ok).toBe(false)` (~line 397); conditional
  `verifySignature` negative case as well.

## Acceptance

- The test always reaches and asserts the below-threshold aggregation outcome;
  an unexpected round-2 failure fails the test loudly instead of skipping.

## Verification

- `deno task test:e2e:frost` fails if the threshold aggregation guard is
  weakened.

## Plan

- Replace `if (!r2.ok) return;` with `expect(r2.ok).toBe(true)` and always
  assert `expect(agg.ok).toBe(false)`.

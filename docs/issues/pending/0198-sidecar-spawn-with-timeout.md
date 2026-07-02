# Add spawnWithTimeout to the sidecar-execution port and dedup the timeout helper

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

The same subprocess-timeout race helper is duplicated in a proof module and a
payment module. A timeout/cleanup bug fixed in one place will be missed in the
other. The sidecar-execution port (issue 0164) is the natural single owner of
"spawn with timeout".

## Rationale

- `packages/sdk/src/payments/frost/frost-cli.ts` (~lines 91-95) and
  `packages/sdk/src/proofs/tlsn-validation.ts` (~lines 403-407) contain the
  same `Promise.race([proc.exited, setTimeout])` + `clearTimeout` guard.

## Acceptance

- A `spawnWithTimeout` (or equivalent) lives on the sidecar-execution adapter;
  both callers use it; the inline race is deleted from both modules.

## Verification

- `rg "Promise.race" packages/sdk/src/payments/frost packages/sdk/src/proofs`
  shows no duplicated spawn-timeout race.
- `deno task test:unit` passes.

## Plan

- Add `spawnWithTimeout` to the execution adapter; route both callers through
  it.

# Revive verified public examples

Created: 2026-05-27
Model: GPT-5 Codex
Completed: 2026-06-01

## Priority

maintenance

## Dependencies

Depends on:
- 0087

Blocks:
- 0080
- 0082
- 0099

## Summary

Restore a small set of public examples that prove the SDK and protocol can be
used outside internal tests. Revived examples must be runnable, documented,
covered by smoke tests or CI, and scoped to current public imports.

## Rationale

The repository previously had many examples and later removed them during the
package and vocabulary cleanup. Before external release, examples should return
only if they are genuinely useful as public proof that the SDK works. They
should not be restored wholesale or used as a dumping ground for old application
domains.

## Acceptance

- Maintainers choose a small public example set, each with one clear lesson.
- Each restored example has a README or inline runbook that states whether it
  is mock, simulation, testnet, or production-ready.
- Each example imports only `@anchr/sdk`, approved `@anchr/sdk/*` subpaths, or
  `@anchr/protocol` for Anchr TypeScript code.
- Each example has a smoke command, test, or `deno task test:examples` coverage
  that detects SDK/API drift.
- Old examples are not restored wholesale; stale domains remain deleted or are
  reintroduced only through a new issue with explicit requirements.

## Verification

- `deno task test:examples`
- No matches are expected: `rg -n "packages/sdk/src|packages/protocol/src|@anchr/bounty|@anchr/sdk/bounty" examples`
- Manual check: each example README states its dependency and production
  boundary.

## Plan

- Use the SDK dogfood result from #0087 to pick the smallest useful example
  candidates.
- Restore or create examples one at a time with smoke coverage.
- Keep example count low until each one earns its maintenance cost.

## Resolution

Implemented by updating:

- `README.md`
- `Dockerfile`
- `deno.json`
- `examples/README.md`
- `examples/sdk-public-api-dogfood.test.ts`
- `examples/paid-request-simulation/README.md`
- `examples/paid-request-simulation/deno.json`
- `examples/paid-request-simulation/mod.ts`
- `examples/paid-request-simulation/mod.test.ts`

Final example status:

- `Simulation`, advertised in `README.md` and `examples/README.md`.

Verified with:

- `deno check examples/paid-request-simulation/mod.ts examples/paid-request-simulation/mod.test.ts examples/sdk-public-api-dogfood.test.ts`
- `deno task smoke` from `examples/paid-request-simulation/`
- `deno task test:examples`
- `rg -n "packages/sdk/src|packages/protocol/src|@anchr/bounty|@anchr/sdk/bounty" examples` returned no matches.
- `deno task lint:dockerfile-workspace`
- `deno test scripts/lint-dockerfile-workspace.test.ts --allow-read`
- `deno task check`
- `deno task test:all`

Harness update:

- Added `examples/paid-request-simulation/mod.test.ts` and kept
  `examples/sdk-public-api-dogfood.test.ts` so `deno task test:examples`
  exercises the advertised public SDK Simulation example.
- Added the example as a workspace member and updated the Dockerfile workspace
  manifest copy, keeping `scripts/lint-dockerfile-workspace.ts` green.

Review residuals:

- None

Follow-up:

- None

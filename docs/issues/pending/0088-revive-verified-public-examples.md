# Revive verified public examples

Created: 2026-05-27
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0087

Blocks:
- 0080
- 0082

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

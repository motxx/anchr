# Move paid request lifecycle to SDK

Created: 2026-05-23
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0050
- 0051
- 0052
- 0053

Blocks:
- 0054

## Summary

Move the reusable lifecycle code currently under `packages/bounty/src/domain/`
and `packages/bounty/src/application/` into SDK-owned paid-request modules, and
delete the old lifecycle directories from `packages/bounty`.

## Rationale

Parent issue #0054 cannot be closed as one coherent change because
`packages/bounty/` still contains domain, application, infrastructure, adapter,
service, and test ownership. This child owns only the in-process paid-request
lifecycle: aggregate transitions, repository/store behavior, service
orchestration, lifecycle validation, verification orchestration ports, and the
tests that lock those behaviors.

Relevant current surfaces:

- `packages/bounty/src/domain/`
- `packages/bounty/src/application/`
- `packages/bounty/src/flow.ts`
- `packages/bounty/src/mod.ts`
- `packages/sdk/src/`

## Acceptance

- Reusable paid-request lifecycle behavior lives under SDK modules with one
  clear request, customer, provider, oracle, payment, proof, or attachment
  owner.
- `packages/bounty/src/domain/`, `packages/bounty/src/application/`,
  `packages/bounty/src/flow.ts`, and `packages/bounty/src/mod.ts` are deleted
  or reduced to no implementation surface because their retained behavior moved
  to SDK.
- Lifecycle unit tests are moved or rewritten under `packages/sdk/src/`.
- New SDK public exports avoid `bounty`, `claim-gate`, and old package names.

## Verification

- No matches are expected:
  `find packages/bounty/src/domain packages/bounty/src/application -type f`
- No matches are expected:
  `rg -n "@anchr/bounty|@anchr/sdk/bounty|packages/bounty/src/(domain|application|flow|mod)" packages e2e deno.json`
- `deno task test:unit`

## Plan

- Classify each domain and application export by SDK owner responsibility.
- Move retained lifecycle code and tests into SDK request-oriented modules.
- Rewrite package and e2e imports that depend only on lifecycle behavior.
- Delete obsolete lifecycle source files after their tests pass from SDK.

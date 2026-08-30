# Remove the hidden module-level OracleRegistry singleton

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

`adapters/oracle-client/registry.ts` exposes both the injectable
`createOracleRegistry` factory (the adapter for the consumer-owned
`OracleRegistry` port) and a hidden module-level `defaultRegistry` singleton
with four free functions layered over it. The singleton is a service locator:
it holds global mutable state shared across callers and tests and bypasses the
port injection the lifecycle uses. One access path should remain.

## Rationale

- `packages/sdk/src/adapters/oracle-client/registry.ts:49` module-level
  `const defaultRegistry = createOracleRegistry()`; the free functions
  (`getOracle`/`listOracles`/`registerOracle`/`resolveOracle`) delegate to it.
- The lifecycle consumes `OracleRegistry` via
  `requests/application/ports.ts:83` with injected instances — the singleton
  is a parallel second entry point.

## Acceptance

- The module-level registry instance and its free-function wrappers are
  removed (callers construct or inject a registry), or a recorded reason keeps
  a named default with its ownership documented.
- No hidden global mutable registry state remains in the adapter.

## Verification

- `rg "defaultRegistry" packages/sdk/src` returns no matches (expected after
  removal).
- `deno task test:unit` passes with no test relying on cross-test registry
  state.

## Plan

- Inventory callers of the free functions; migrate them to injected/explicit
  registries; delete the singleton.

Completed: 2026-07-06

## Resolution

Caller inventory: the free functions were consumed only by
`oracle-client/oracle.test.ts` and re-exported by `oracle-client/index.ts` —
no production caller existed (`query-verification.ts` already consumes an
injected `OracleResolver`). `createOracleRegistry` is now the single access
path.

Implemented by updating:

- `packages/sdk/src/adapters/oracle-client/registry.ts` — deleted
  `defaultRegistry` and `getOracle`/`listOracles`/`registerOracle`/
  `resolveOracle`.
- `packages/sdk/src/adapters/oracle-client/index.ts` — barrel now exports
  only `createOracleRegistry` from the registry module.
- `packages/sdk/src/requests/application/query-verification.ts` — resolver
  doc comment no longer mentions a fallback singleton.

Deleted files:

- `packages/sdk/src/adapters/oracle-client/oracle.test.ts` — every test was a
  duplicate of `registry.test.ts` run through the singleton (including an
  order-dependent "starts empty" assertion on shared global state);
  `registry.test.ts` covers the same behaviors against constructed, isolated
  instances.

Verified with:

- `grep -r "defaultRegistry|getOracle\b|registerOracle|listOracles" packages/
  e2e/ scripts/ examples/` — no matches.
- `deno task check`, `deno task lint:strict`, `deno task test:unit`,
  `deno task test:all` — pass.
- `/check-silent-bypass` and `/arch-lint-llm` — no findings.

Harness update:

- None — the arch-lint-llm skill's L002 (hidden service locator) rubric
  already owns this class of finding; this resolution removed the repo's
  remaining instance.

Review residuals:

- None.

Follow-up:

- None.

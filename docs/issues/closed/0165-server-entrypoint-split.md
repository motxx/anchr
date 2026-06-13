# Split the Deno.serve Oracle bootstrap out of the library module

Created: 2026-06-13
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0149
- 0150

## Summary

Child of 0149 (server entrypoint split). `packages/sdk/src/adapters/oracle-service/server.ts`
calls `Deno.serve` and reads `Deno.env` at module scope to bootstrap the reduced
FROST peer endpoint app. Bootstrap belongs in a dedicated entrypoint, not in a
library module imported by the portable surface, so importing the SDK does not
pull in `Deno.serve` / module-scope env reads.

Current entrypoint coupling:

- `packages/sdk/src/adapters/oracle-service/server.ts:119` — `Deno.serve(...)`.
- Same file — module-scope `Deno.env.get` reads (`ORACLE_ID`, `ORACLE_API_KEY`,
  `ORACLE_PORT`, `ORACLE_FEE_PPM`, `FROST_CONFIG_PATH`).

The reduced FROST peer endpoint *app builder* (`buildOracleApp`, consumed by
`e2e/frost/frost-threshold.test.ts`) stays importable as a library function; only
the process bootstrap (`Deno.serve` + env wiring) moves to a separate entrypoint.

## Rationale

- Premise: importing the Customer/Provider/Oracle library modules must not
  execute `Deno.serve` or module-scope env reads, so the browser surface and the
  0150 gate stay clean.
- `buildOracleApp` remains a pure builder; the entrypoint owns process lifecycle.

## Acceptance

- `Deno.serve` and module-scope env wiring move to a dedicated entrypoint (e.g.
  a `*-entry.ts` / bin module) that is not imported by library code; the FROST
  app builder remains importable without side effects.
- `e2e/frost/frost-threshold.test.ts` still builds the FROST app via the library
  builder.

## Verification

- No matches are expected in library modules (only in the entrypoint):
  `rg "Deno\.serve" packages/sdk/src`
- `deno task check`, `deno task lint:strict`, `deno task test:all` (including
  `test:e2e:frost`) pass.

## Plan

- Extract the `Deno.serve` bootstrap + env wiring into a separate entrypoint;
  keep `buildOracleApp` as a side-effect-free library export.
- Update any task/docs that launched the old server module path.

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/oracle-service/server.ts`
- `packages/sdk/src/adapters/oracle-service/server-entry.ts`

Verified with:

- `rg "Deno\.serve" packages/sdk/src`
- `deno task check`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:e2e:frost`

Harness update:

- `rg "Deno\.serve" packages/sdk/src` guards library-module bootstrap;
  `test:e2e:frost` locks the side-effect-free `buildOracleApp` builder import.

Review residuals:

- None

Follow-up:

- None

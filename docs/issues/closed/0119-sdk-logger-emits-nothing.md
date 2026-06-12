# SDK logger emits nothing and ANCHR_LOG_LEVEL is dead

Created: 2026-06-11
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`@anchr/sdk` configures no logTape pipeline, so a standalone consumer gets no
logs at all, and the `ANCHR_LOG_LEVEL` / `LOG_LEVEL` knob advertised by
`CLAUDE.md` does nothing. Either configure logging from a Deno-native env signal
or remove the env-var claim and document the host's required setup.

## Rationale

From `docs/production-readiness-audit.md` §2.7 (OPS-01):

- `packages/sdk/src/internal/runtime/logger.ts:1-43` only calls
  `ltGetLogger(category)` and emits; there is no `configure()`/sink
  registration anywhere, and `ANCHR_LOG_LEVEL`/`LOG_LEVEL` appear nowhere under
  `packages/`/`scripts/`/`examples/`.
- The header comment references a non-existent `src/infrastructure/logger.ts`.
- logTape with no `configure()` emits nothing by default, so production
  settlement/verification flows are unobservable.

## Acceptance

- Running an SDK flow with `ANCHR_LOG_LEVEL` (or `LOG_LEVEL`) set produces log
  output at the requested level via a registered sink; or, if configuration is
  intentionally the host's responsibility, the env-var claim is removed from
  `CLAUDE.md` and `docs/production-readiness-audit.md` §1 and the required host
  `configure()` call is documented.

## Verification

- A new logger unit test asserts that setting the env var changes emitted
  output: `ANCHR_LOG_LEVEL=debug deno test <new logger test>`.
- Expected after the chosen fix:
  `rg -n "ANCHR_LOG_LEVEL|LOG_LEVEL" packages/sdk/src` returns a real consumer
  (configure path), or returns nothing if the claim is removed and the doc is
  updated to match.
- `deno task lint:strict`

## Plan

- Re-read `logger.ts` and decide configure-in-SDK vs document-host-setup.
- If configuring: add an idempotent `configure()`/`configureSync()` registering
  a console sink, reading the level from
  `Deno.env.get("ANCHR_LOG_LEVEL") ?? Deno.env.get("LOG_LEVEL")` (default
  `"info"`), invoked once on first `getLogger`.
- Fix the stale comment referencing the non-existent infrastructure file.

## Resolution

Decision: configure in the SDK from the documented env knob.

Implemented by updating:

- `packages/sdk/src/internal/runtime/logger.ts` — first `getLogger` call
  registers a console sink whose lowest level comes from `ANCHR_LOG_LEVEL`
  (fallback `LOG_LEVEL`, default `info`); `configureAnchrLogging` is the
  explicit host entry point (custom sink / `reset`); a host that already
  configured logTape wins (the SDK never overrides); the stale
  `src/infrastructure/logger.ts` header reference is gone
- `packages/sdk/src/internal/runtime/logger.test.ts` (new) — env-driven
  level changes emitted output (debug opt-in, info default, LOG_LEVEL
  fallback)

Verified with:

- `deno task test:unit`
- `rg -n "ANCHR_LOG_LEVEL|LOG_LEVEL" packages/sdk/src` returns the real
  consumer in `logger.ts`

Harness update:

- `logger.test.ts` locks the env-driven pipeline.

Review residuals:

- None

Follow-up:

- None

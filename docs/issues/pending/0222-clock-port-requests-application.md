# Finish Clock-port adoption where Date.now() bypasses it

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

The requests domain defines and honors an injected `Clock` port (explicitly to
stop scattered `Date.now()` calls), but the application layer above it
reintroduces raw `Date.now()` for the expiry decision and `submitted_at`
timestamps, and `ServiceDeps` does not thread a clock at all. Expiry and
submission timestamps are therefore non-deterministic and untestable in the
very layer that decides them — the port's guarantee is silently broken. The
EXIF proof schema's recency check has the same bypass.

## Rationale

- `packages/sdk/src/requests/application/query-lifecycle-methods.ts` (~lines
  66, 91, 121) and `query-service.ts` (~line 164) call `Date.now()` directly
  (e.g. `query.expires_at < Date.now()`).
- `requests/domain/ports.ts` (~lines 13-16) defines `Clock`; the domain uses
  `services.clock.now()` (`query-aggregate.ts` ~58, 125, 295).
- `packages/sdk/src/proofs/exif-validation.ts` (~line 418): the recency check
  also calls `Date.now()` instead of the injected clock.

## Acceptance

- `ServiceDeps` carries `clock: Clock` and all four `Date.now()` call sites in
  `requests/application` use the injected clock.
- The `exif-validation.ts` recency check uses the injected clock.

## Verification

- `rg "Date\.now\(\)" packages/sdk/src/requests/application packages/sdk/src/proofs/exif-validation.ts`
  returns no matches.
- A unit test drives expiry deterministically through an injected fake clock.

## Plan

- Add `clock` to `ServiceDeps`; replace the four call sites plus the EXIF
  recency site; add a fake-clock expiry test.

# Relocate EXIF GPS hint fixtures out of request tests

Created: 2026-06-13
Model: GPT-5 Codex
Completed: 2026-06-13

## Priority

maintenance

## Dependencies

Depends on:
- 0147

Blocks:
- None

## Summary

After verification GPS moved into the C2PA schema payloads, the request package
still contains `hasGps` / `gpsNearHint` fixture vocabulary in request-service
tests. Those fields describe EXIF metadata hints owned by proof integrity
records, not request-domain verification state.

## Rationale

The remaining matches are:

- `packages/sdk/src/requests/application/query-service-defaults.test.ts`
- `packages/sdk/src/requests/application/query-service.test.ts`

They are distinct from `expected_gps`, `max_gps_distance_km`, and submitted
verification GPS, but they still keep GPS-flavoured proof vocabulary visible
under `packages/sdk/src/requests/`.

## Acceptance

- Request-layer tests no longer construct proof-integrity fixtures with
  `hasGps` or `gpsNearHint` inline.
- EXIF GPS hint fixture construction lives with proof/integrity test helpers
  or another proof-owned module.

## Verification

- No matches are expected:
  `rg "hasGps|gpsNearHint" packages/sdk/src/requests/`
- `deno task test:unit` passes.

## Plan

- Inspect why request-service tests construct proof integrity records directly.
- Move the shared EXIF metadata fixture builder to a proof-owned testing helper.
- Update request-service tests to call the helper without naming GPS hint
  fields locally.

## Resolution

Implemented by updating:

- `packages/sdk/src/requests/application/query-service-defaults.test.ts`
- `packages/sdk/src/requests/application/query-service.test.ts`

Verified with:

- `rg "gps|Gps" packages/sdk/src/requests/`
- `deno task check`
- `deno task lint:strict`
- `deno task test:unit`

Harness update:

- The negative guard `rg "gps|Gps" packages/sdk/src/requests/` absorbs this
  class of request-package proof-vocabulary drift.

Review residuals:

- None

Follow-up:

- None

# Move GPS verification out of the shared core into schema-owned checks

Created: 2026-06-12
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0143
- 0144
- 0145

Blocks:
- 0142

## Summary

GPS proximity verification is a schema-specific concern (location-bound
photo proofs) living in the shared core. Move `GpsCoord`, `expected_gps`,
`max_gps_distance_km`, and the GPS factor checks into the schema(s) that own
location semantics (today: the C2PA-image schema, whose INV-06 binding stays
intact), using the schema-scoped payloads from 0145.

Current placement:

- `packages/sdk/src/values.ts:13-16` — `GpsCoord` in the shared value leaf.
- `packages/sdk/src/proofs/verification/contract.ts:35-37` —
  `expected_gps` / `max_gps_distance_km` on the shared requirement;
  `gps` on the shared input.
- `packages/sdk/src/requests/domain/types.ts` — the same fields on the
  `Query` aggregate.
- `packages/sdk/src/proofs/verification/checks/gps.ts`,
  `checks/photo-integrity.ts` (GPS portions), `proofs/geo.ts`,
  plus the duplicated distance-policy evaluation tracked by 0140.

## Rationale

- Schemas that have nothing to do with location (e.g. a TLSN API-response
  proof, or any third-party schema) currently carry GPS fields in their
  requirement, input, and `Query` state.
- After 0144 removes `ai_check`, GPS is the last non-schema factor with
  domain semantics in the shared union; relocating it is what lets 0143's
  "factors are schema-internal" decision complete.
- 0138 (enforce gps factor without expected location) and 0140 (deduplicate
  GPS distance policy) touch the same code; resolve or re-scope them against
  the relocated owner rather than fixing the old location twice.

## Acceptance

- `rg "gps|Gps" packages/sdk/src/values.ts packages/sdk/src/requests/` has
  no matches; GPS types and checks live under the owning schema module.
- INV-06 (C2PA manifest signature binds GPS evidence) still has a passing
  test and an unchanged or justified-and-bumped entry in
  `docs/threat-model.lock.json`.
- Issues 0138 and 0140 are updated to point at the new owner if they are
  still open when this lands.

## Verification

- No matches are expected:
  `rg "expected_gps|max_gps_distance_km" packages/sdk/src/requests/ packages/sdk/src/values.ts`
- `deno task lint:invariants` and `deno task test:all` pass.

## Plan

- Define the location requirement/evidence shape inside the owning schema
  module; carry it via the 0145 payload fields.
- Collapse the three distance-policy implementations onto the schema owner
  (supersedes the GPS portion of 0140).
- Update threat-model INV-06 test wiring if file paths move.

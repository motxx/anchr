# Move GPS verification out of the shared core into schema-owned checks

Created: 2026-06-12
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0143

## Summary

GPS proximity verification is schema-specific vocabulary for location-bound
photo proofs. Move `GpsCoord`, `expected_gps`, `max_gps_distance_km`, and the
GPS factor checks into the schema(s) that own location semantics (today: the
C2PA-image schema, whose INV-06 binding stays intact), using the schema-scoped
payloads from 0146.

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
- After 0145 removes `ai_check`, GPS is the last non-schema factor with
  domain semantics in the shared union; relocating it is what lets 0144's
  "factors are schema-internal" decision complete.
- 0138 (enforce gps factor without expected location) and 0140 (deduplicate
  GPS distance policy) touch the same code; resolve or re-scope them against
  the relocated owner rather than fixing the old location twice.

## Acceptance

- `rg "gps|Gps" packages/sdk/src/values.ts packages/sdk/src/requests/` has
  no matches; GPS types and checks live under the owning schema module.
- The C2PA-image schema owns signed GPS evidence, maximum-distance policy, and
  any local GPS factor vocabulary as schema-internal payload/check semantics.
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
  module; carry it via the 0146 payload fields.
- Collapse the three distance-policy implementations onto the schema owner
  (supersedes the GPS portion of 0140).
- Update threat-model INV-06 test wiring if file paths move.

## Resolution

Implemented by updating:

- `packages/sdk/src/values.ts`
- `packages/sdk/src/proofs/c2pa-validation.ts`
- `packages/sdk/src/proofs/exif-validation.ts`
- `packages/sdk/src/proofs/verification/contract.ts`
- `packages/sdk/src/proofs/verification/verifier.ts`
- `packages/sdk/src/proofs/verification/checks/photo-integrity.ts`
- `packages/sdk/src/proofs/verification/checks/empty-submission.ts`
- `packages/sdk/src/proofs/verification/checks/registry.ts`
- `packages/sdk/src/requests/domain/types.ts`
- `packages/sdk/src/requests/domain/value-objects.ts`
- `packages/sdk/src/requests/domain/query-aggregate.ts`
- `packages/sdk/src/requests/application/query-verifier.ts`
- `packages/sdk/src/adapters/nostr/oracle-handlers.ts`
- `packages/sdk/src/attachments/upload.ts`
- `packages/sdk/src/index.ts`
- `packages/sdk/src/proofs/verification/checks/gps.ts` (deleted)
- Focused unit/integration/e2e tests and issue-tracking docs for the new
  schema-owned payload boundary.

The C2PA-image schema now owns:

- `GpsCoord` in `packages/sdk/src/proofs/c2pa-validation.ts`.
- `C2paImageRequirement`: `{ expected_gps?: GpsCoord; max_gps_distance_km?: number }`.
- `C2paImageEvidence`: `{ gps?: GpsCoord }`.
- Type predicates `isC2paImageRequirement`, `isC2paImageEvidence`, and
  `isGpsCoord`.
- The schema-owned GPS proximity evaluator used by C2PA manifest GPS,
  schema-evidence GPS, ProofMode GPS, and EXIF hint checks.

Verified with:

- `rg 'expected_gps|max_gps_distance_km' packages/sdk/src/requests/ packages/sdk/src/values.ts` (no matches)
- `rg 'gps|Gps' packages/sdk/src/values.ts` (no matches)
- `rg -n 'gps|Gps' packages/sdk/src/requests/` (only `hasGps` /
  `gpsNearHint` EXIF hint fixtures remain; follow-up 0158)
- `deno task lint:invariants`
- `deno task check`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:integration`
- Focused verifier/C2PA tests:
  `deno test --allow-all packages/sdk/src/proofs/c2pa-validation.test.ts packages/sdk/src/proofs/verification/verifier.test.ts packages/sdk/src/proofs/verification/verifier-standalone.test.ts packages/sdk/src/requests/domain/query-aggregate.test.ts packages/sdk/src/requests/domain/value-objects.test.ts packages/sdk/src/adapters/nostr/oracle-service.integration.test.ts`
- `check-silent-bypass` review of changed package source files: no
  silent-bypass patterns detected; recorded with
  `scripts/silent-bypass-verify.ts --record`.

Harness update:

- `packages/sdk/src/proofs/c2pa-validation.test.ts` locks C2PA-owned GPS
  payload predicates and INV-06 signed-manifest GPS binding.
- `packages/sdk/src/proofs/verification/verifier.test.ts` and
  `packages/sdk/src/proofs/verification/verifier-standalone.test.ts` lock the
  C2PA schema-evidence GPS check and ensure the shared verifier contract stays
  GPS-free.
- `packages/sdk/src/adapters/nostr/oracle-service.integration.test.ts` locks
  canonical relay result `data` mapping into C2PA `schema_evidence`.
- The negative rg guards above lock the removal of request/value GPS fields.
- INV-06 test wiring did not move, so `docs/threat-model.lock.json` was not
  bumped; `deno task lint:invariants` confirms the existing lock is consistent.

Review residuals:

- `deno task test:e2e:relay` was attempted but failed before tests ran because
  `NOSTR_RELAYS` was not set and required relay infrastructure was unavailable.
  Rerun the relay e2e bucket in an environment with a relay, for example with
  `NOSTR_RELAYS=ws://localhost:7777`.

Follow-up:

- 0158 relocates the remaining request-test `hasGps` / `gpsNearHint` EXIF hint
  fixtures out of `packages/sdk/src/requests/`.
- The GPS portion of 0140 is superseded by the C2PA-owned proximity evaluator.

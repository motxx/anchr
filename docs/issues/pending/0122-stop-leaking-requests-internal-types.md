# Stop leaking requests/ internal types on the public SDK surface

Created: 2026-06-11
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Public SDK functions take or return `requests/`-owned domain types that are
exported only from `@anchr/sdk/testing` (a testing entry point) or from nowhere
public. A consumer of documented flows cannot name the parameter/return types
without importing a testing-only module. Decide an owner home for the public
proof-verification/Oracle contract and add an arch-lint rule that catches the
leak.

## Rationale

From `docs/production-readiness-audit.md` §2.2 (SDK-01):

- `packages/sdk/src/proofs/verification/verifier.ts:12-18,62,76,91` (`verify`,
  `requestToRequirement`) and `oracle-service.ts:37-40,95-107`
  (`verifyAndDeliver`) take/return `Query`, `QueryResult`,
  `VerificationRequirement`, `VerificationInput`, `VerificationDetail`,
  `OracleRegistry`, `BlossomKeyMap`.
- Those types are exported only from `@anchr/sdk/testing`
  (`packages/sdk/src/testing/mod.ts:6-19`) or not publicly at all.
- `docs/architecture.md:118-122,131` assigns them to `requests/domain/`, "not a
  public `@anchr/sdk/requests` subpath".
- `deno task lint:arch` authorises the file-to-file import edges but never
  checks whether a `requests/`-owned type is re-exported through a public
  `deno.json` subpath.

## Acceptance

- Every public function's parameter and return types are nameable by importing
  only non-`/testing` subpaths (types moved to the owning feature dir and
  re-exported from the subpath that exposes them, or replaced with
  request-shaped DTOs).
- `scripts/arch-lint.ts` flags any `requests/`-owned type reachable from a
  non-`/testing` `deno.json` export.

## Verification

- `deno task lint:arch` (with the new rule) passes.
- A `deno check` on a sample consumer importing only non-`/testing` subpaths can
  name every public function's param/return types.
- `deno task test:unit`

## Plan

- Re-read the public proof-verification/Oracle surface and the architecture
  ownership table.
- Choose move-to-owner vs DTO; this issue owns the `Query`/verification type
  family. The TLSN-type second barrel (ARCH-04) is owned by the
  architecture-conformance issue — coordinate but do not overlap.
- Add the arch-lint rule and lock with a sample-consumer compile check.

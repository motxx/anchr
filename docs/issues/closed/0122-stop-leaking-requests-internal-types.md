# Stop leaking requests/ internal types on the public SDK surface

Created: 2026-06-11
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0130
- 0131
- 0132
- 0133

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

Constraint discovered 2026-06-11 (do not treat this as a mechanical move):
the leak is bidirectionally entangled with the `Query` aggregate. `Query`
embeds `VerificationDetail` and `BlossomKeyMap`
(`packages/sdk/src/requests/domain/types.ts:282,292`), while
`VerificationRequirement`/`VerificationInput`/`VerificationDetail` reference the
shared submission vocabulary `AttachmentRef`/`GpsCoord`/`VerificationFactor`
owned by the same `requests/domain/types.ts`. Moving only the verification I/O
contract to `proofs/` creates a `requests/domain ↔ proofs` type cycle; moving
the shared vocabulary too has wide blast radius across `customer`/`provider`/
`adapters`. A clean fix needs a deliberate owner decision (e.g. a neutral
shared submission-vocabulary module that both `requests/domain` and `proofs`
import in one direction). This is design work, not a rename — split with
`make-sub-issues` before implementing.

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
  ownership table, then decide the owner home for the verification I/O contract
  and the shared submission vocabulary given the cycle constraint above.
- Split with `make-sub-issues` (likely: one child for the shared-vocabulary /
  verification-contract re-home, one child for the arch-lint enforcement that
  flags `requests/`-owned types re-exported from non-`/testing` subpaths).
- The TLSN-type second barrel (ARCH-04, the other half of this god module) is
  already resolved (2026-06-11): the re-export barrel in
  `requests/domain/types.ts` was removed and the proofs/adapters TLSN imports
  repointed to `proofs/tlsn-types.ts` / `@anchr/sdk/proofs`. The remaining
  leak is only the `Verification*`/`BlossomKeyMap` family.
- Add the arch-lint rule and lock with a sample-consumer compile check.

Completed: 2026-06-12

## Resolution

Resolved via the A-full split (cycle-free) across four child issues:

- **0130** — shared submission/evidence vocabulary moved to the neutral leaf
  `packages/sdk/src/values.ts` (re-exported from root `@anchr/sdk`); `BlossomKeyMap`
  duplicate removed.
- **0131** — the proof-verification contract (`VerificationRequirement`,
  `VerificationInput`, `VerificationDetail`, `VerifyProofOptions`) moved to
  `proofs/verification/contract.ts` and exported from `@anchr/sdk/proofs`.
- **0133** — the `Query`→contract adapters (`verify`,
  `requestToRequirement`, `resultToVerificationInput`) moved to
  `requests/application/query-verifier.ts`; `proofs/` now imports nothing from
  `requests/`, and `Query` no longer leaks through the public proofs surface.
- **0132** — arch-lint rule **E029** locks the boundary: requests/ types may not
  be re-exported to a non-`/testing` surface except the documented ports and
  Oracle-client contract.

Outcome: every public proof-verification function's parameter and return types
are now nameable by importing only non-`/testing` subpaths (`@anchr/sdk` root
for the value objects, `@anchr/sdk/proofs` for the verification contract), and
the leak class is CI-enforced.

Verified with:

- `deno task check`, `deno task test:all`, `deno task lint:strict`,
  `deno task lint:arch` (all green across each phase)
- Negative: `proofs/` imports nothing from `requests/`; a scratch `Query`
  re-export trips E029

Harness update:

- `scripts/arch-lint.ts` E029 + `scripts/arch-lint.test.ts` (see 0132).

Review residuals:

- The Oracle-client contract types remain `requests/domain`-owned as a
  documented intentional public re-export (see 0132); optional future
  relocation to `adapters/oracle-client/`.

Follow-up:

- None.

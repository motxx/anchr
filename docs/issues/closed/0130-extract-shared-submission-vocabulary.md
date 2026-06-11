# Extract shared submission/evidence vocabulary to a neutral leaf module

Created: 2026-06-12
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0122

## Summary

Move the cross-cutting submission/evidence value objects out of the
`requests/domain/types.ts` god module into a neutral leaf module that imports
nothing from feature directories, and dedupe `BlossomKeyMap`. This breaks the
`proofs ↔ requests/domain` type cycle that otherwise blocks moving the
proof-verification contract (issue 0131), so it must land first.

## Rationale

Parent: issue 0122 (A-full direction, chosen 2026-06-12).

`requests/domain/types.ts` is imported by ~35 files and bundles three concerns:
request lifecycle state, shared submission vocabulary, and the proof-verification
contract. The shared vocabulary in scope here:

- `AttachmentRef`, `GpsCoord`, `VerificationFactor` (and
  `VERIFICATION_FACTORS` / `DEFAULT_VERIFICATION_FACTORS`)
- `BlossomKeyMaterial`, `BlossomKeyMap` — currently duplicated identically in
  `packages/sdk/src/requests/domain/types.ts:95-101` and
  `packages/sdk/src/proofs/ai-content-check.ts:52-58`.

About 10 non-test files import these from `requests/domain/types.ts`
(`attachments/*`, `proofs/verification/checks/*`, `adapters/oracle-client/*`,
`testing/attachments.ts`), plus the tests.

A neutral leaf module (importing nothing from `requests/`, `proofs/`,
`attachments/`, `adapters/`) lets `proofs/` and `requests/domain/` both depend
on it in one direction, eliminating the cycle. The exact module name/location is
decided by this issue (candidate: a top-level `packages/sdk/src/domain-values.ts`
or `packages/sdk/src/values/`); whatever is chosen must be reachable on the
public surface because these types appear in public signatures.

## Acceptance

- A single neutral leaf module owns `AttachmentRef`, `GpsCoord`,
  `VerificationFactor`, `VERIFICATION_FACTORS`, `DEFAULT_VERIFICATION_FACTORS`,
  `BlossomKeyMaterial`, `BlossomKeyMap`; the duplicate in
  `proofs/ai-content-check.ts` is gone.
- The module imports nothing from `requests/`, `proofs/`, `attachments/`, or
  `adapters/` (it is a leaf).
- All importers (including `requests/domain/types.ts`) import these types from
  the new module; `requests/domain/types.ts` no longer defines them.
- These types remain nameable from a non-`/testing` public subpath.

## Verification

- `deno task check`
- `deno task test:all`
- `deno task lint:strict` (including `lint:arch`)
- No matches expected:
  `rg -n "interface BlossomKeyMaterial|type BlossomKeyMap" packages/sdk/src/proofs/ai-content-check.ts`

## Plan

- Decide the module name/location and whether it needs its own `deno.json`
  export or is re-exported through existing public subpaths; update
  `packages/sdk/deno.json` publish allowlist accordingly.
- Create the leaf module; move the seven types/consts into it.
- Repoint every importer; delete the definitions from
  `requests/domain/types.ts` and the duplicate from `ai-content-check.ts`.
- Add the new module to `scripts/arch-lint.ts` allowed-deps (leaf) and the
  `docs/architecture.md` component/ownership notes.

Completed: 2026-06-12

## Resolution

Implemented by updating:

- `packages/sdk/src/values.ts` (new leaf module: `AttachmentRef`,
  `AttachmentStorageKind`, `GpsCoord`, `VerificationFactor`,
  `VERIFICATION_FACTORS`, `DEFAULT_VERIFICATION_FACTORS`, `BlossomKeyMaterial`,
  `BlossomKeyMap`; imports nothing from feature directories)
- `packages/sdk/src/requests/domain/types.ts` (definitions removed; imports the
  vocab it embeds from `../../values.ts`)
- `packages/sdk/src/proofs/ai-content-check.ts` (duplicate `BlossomKey*`
  removed; imported from `../values.ts`)
- ~25 importers across `attachments/`, `proofs/verification/checks/`,
  `adapters/`, `payments/frost/`, `requests/`, and their tests repointed to
  `values.ts`
- `packages/sdk/src/index.ts` re-exports the vocab from the root `@anchr/sdk`
- `packages/sdk/deno.json` publish allowlist adds `src/values.ts`
- `docs/architecture.md` ownership table + leaf-module note

Verified with:

- `deno task check`
- `deno task test:all`
- `deno task lint:strict`
- `deno task publish:dry-run`
- Negative: `rg -n "interface BlossomKeyMaterial|type BlossomKeyMap = " packages/sdk/src/proofs/ai-content-check.ts` → no matches (duplicate gone)

Harness update:

- None — this is a one-time structural relocation. The boundary it establishes
  is enforced by the arch-lint rule tracked in issue 0132 (no `requests/`-owned
  type reachable from a non-`/testing` public export). No silent-bypass review
  needed: the change is import/export only, with no verification/settlement
  logic altered.

Review residuals:

- None. The `proofs ↔ requests/domain` type cycle is eliminated; issue 0131 can
  now move the verification contract to `proofs/` cleanly.

Follow-up:

- 0131 (move verification contract to proofs), 0132 (arch-lint guard).

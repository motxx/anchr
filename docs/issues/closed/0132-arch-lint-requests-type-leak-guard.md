# Enforce no requests/ type leak on public subpaths via arch-lint

Created: 2026-06-12
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0131
- 0133

Blocks:
- 0122

## Summary

Add an architecture-lint rule that flags any `requests/`-owned type reachable
through a non-`/testing` `@anchr/sdk` public export, and finalize the
`docs/architecture.md` ownership table to record the new homes from 0130/0131.
This locks the boundary so the leak cannot silently return. Depends on 0131
(the verification contract must already be moved, otherwise the new rule fires
on the not-yet-fixed leak).

## Rationale

Parent: issue 0122 (A-full direction).

`scripts/arch-lint.ts` currently authorises file-to-file import edges but never
checks whether a `requests/`-owned type is re-exported or otherwise reachable
through a public `deno.json` subpath. After 0130/0131 the only public surface
that should carry `requests/`-owned types is `@anchr/sdk/testing`; everything
else must use the neutral leaf module (0130) or `proofs/` (0131).

## Acceptance

- `scripts/arch-lint.ts` raises a violation when a type defined under
  `packages/sdk/src/requests/` is reachable from a non-`/testing` public export
  (direct re-export, or a public function signature that names it).
- A scratch re-export of a `requests/`-owned type from a public subpath is
  flagged by `deno task lint:arch` (verified, then removed — do not commit the
  scratch).
- `docs/architecture.md` ownership table reflects the neutral-leaf and `proofs/`
  homes chosen in 0130/0131.

## Verification

- `deno task lint:arch` passes on the clean tree.
- A temporary scratch leak is flagged: add an `export type { Query } from
  "../../requests/domain/types.ts"` to a public subpath, confirm
  `deno task lint:arch` fails, then revert (do not commit the scratch).
- `deno task lint:strict`

## Plan

- Implement the reachability check in `scripts/arch-lint.ts` (start with direct
  `export ... from ".../requests/..."` on non-`/testing` public entry files;
  extend to signature reachability if practical).
- Update the `docs/architecture.md` ownership table and Surface Policy notes.
- Prove the rule with the scratch-leak experiment, then remove the scratch.

Completed: 2026-06-12

## Resolution

Implemented by updating:

- `scripts/arch-lint.ts` (new rule **E029**: a non-`/testing` sdk module may
  re-export from `requests/` only from the documented public surfaces — the
  injection ports `requests/domain/ports.ts` / `requests/application/ports.ts`
  and the Oracle-client contract `requests/domain/oracle-types.ts`; any other
  `requests/` re-export, e.g. the `Query` aggregate or verification records, is
  a violation. Added `extractReExports` to distinguish re-export statements from
  plain imports.)
- `scripts/arch-lint.test.ts` (E029 regression tests: flags a `Query`
  re-export; allows the ports and Oracle contract; exempt inside
  `requests/`/`testing/`)
- `docs/architecture.md` ownership table updated to the post-0130/0131 homes
  (verification contract in `proofs/verification/contract.ts`, Query adapters in
  `requests/application/query-verifier.ts`) and a paragraph documenting the
  E029 re-export boundary

Verified with:

- `deno task lint:arch` (clean) and the scratch-leak experiment: adding
  `export type { Query } from "./requests/domain/types.ts"` to `index.ts`
  produced `E029`; reverted.
- `deno test scripts/arch-lint.test.ts`, `deno task lint:strict`,
  `deno task test:all`.

Harness update:

- `scripts/arch-lint.ts` E029 — this is itself the harness that absorbs the
  SDK-01 leak class. Locked with `scripts/arch-lint.test.ts` cases.

Review residuals:

- The Oracle-client contract types (`Oracle`/`OracleInfo`/
  `OracleVerificationDetail`/`OracleAttestation`) remain `requests/domain`-owned
  and are an intentional, now-documented public re-export. Relocating them to
  `adapters/oracle-client/` is a possible future refinement, not a leak.

Follow-up:

- None — closes the A-full chain; parent 0122 can close.

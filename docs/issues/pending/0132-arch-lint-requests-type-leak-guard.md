# Enforce no requests/ type leak on public subpaths via arch-lint

Created: 2026-06-12
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0131

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

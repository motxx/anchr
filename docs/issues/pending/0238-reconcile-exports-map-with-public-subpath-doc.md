# Reconcile deno.json exports with the documented public subpaths and gate it

Created: 2026-07-03
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The SDK's actual export map and the architecture doc's "Public Subpaths"
enumeration disagree, and nothing checks them against each other.
`packages/sdk/deno.json` exports `./schema` (which the doc's
Browser-Portable section itself references as `@anchr/sdk/schema`) yet the
Public Subpaths list omits `/schema`; `./attachments/blossom` is exported
but undocumented; the per-adapter subpaths (`/adapters/cashu`, `/nostr`,
`/storage`, `/oracle-client`, `/oracle-service`) are finer-grained than the
documented `/adapters`. The Surface Policy says new public surface requires
updating the doc and lint first — but no lint ties the exports map to the
documented list, so the policy cannot hold. Decide the authoritative
subpath set, align doc and map, and add a gating check.

## Rationale

- `packages/sdk/deno.json` `exports` vs `docs/architecture.md`
  "Public Subpaths" (survey 2026-07-03).
- Internal doc contradiction: Browser-Portable Surface lists
  `@anchr/sdk/schema`; Public Subpaths does not allow it.
- Coordinate with 0225 (root barrel composition), 0224 (`./adapters` dead
  barrel target), and 0206 (doc meta-commentary sweep) — this issue owns
  only the subpath set + the doc/map consistency gate.

## Acceptance

- One recorded, authoritative public-subpath list; `deno.json` exports and
  `docs/architecture.md` agree with it exactly.
- A gating check (arch-lint rule or script in `lint:strict`) fails when the
  exports map and the documented list diverge.

## Verification

- The new check passes on the reconciled tree; adding an undocumented
  export to `packages/sdk/deno.json` makes `deno task lint:strict` fail
  (expected failure).
- `deno task publish:dry-run` passes.

## Plan

- Classify each currently exported subpath (document / remove / rename).
- Align doc + map; add the consistency check to the lint chain.

# Unify paid-request lifecycle behind one engine

Created: 2026-06-10
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0104
- 0105
- 0106
- 0107
- 0108
- 0109

Blocks:
- None

## Summary

Tracking issue for `docs/lifecycle-unification-design.md`: collapse the two
Customer/Provider/Oracle orchestration implementations (root
`customer.ts`/`provider.ts` world and the `adapters/nostr/*-service` +
`requests/` world) into one lifecycle engine behind the unchanged public SDK
surface, preserving the privacy invariants P1-P6 defined in the design.

## Rationale

`docs/lifecycle-unification-design.md` records the target architecture, the
six privacy invariants (ephemeral identity, relay-only lifecycle,
advertisement hygiene, region privacy, bearer settlement, public
attestations), and the migration order. Maintainer direction: the anonymous
Nostr P2P exchange interface must be preserved through the unification.

## Acceptance

- All child issues (0104-0109) are closed.
- One lifecycle implementation remains; the public SDK API is unchanged.
- Privacy invariants P1-P6 each have a locking test.

## Verification

- `deno task test:all` and `deno task test:all:docker`
- Design-doc invariant table maps every row to a green test.

## Plan

- Resolve children in order 0104 → 0105/0106 → 0107 → 0108 → 0109.
- This issue closes when the last child closes; it owns no code change.

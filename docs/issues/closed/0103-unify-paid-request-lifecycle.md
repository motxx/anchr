# Unify paid-request lifecycle behind one engine

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

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

## Resolution

Tracking issue: all six children closed on 2026-06-10.

- #0104 — INV-07/INV-08 privacy invariants locked with tests.
- #0105 — one identity-policy module, ephemeral-by-default everywhere.
- #0106 — relay-DM hash bootstrap is the default OracleClient.
- #0107 — root orchestrators run on injected Clock/IdGenerator with one
  subscribe-with-deadline helper; query ids have one owner.
- #0108 — Dvm dialect and the second Customer/Provider implementation
  deleted; region scoping rides the canonical advertisement.
- #0109 — one Oracle daemon on the RelayClient port; singleton transport
  deleted; HTTP/FROST routes remain the optional operator adapter.

One lifecycle implementation remains behind the unchanged public SDK API,
and every privacy invariant P1-P6 from `docs/lifecycle-unification-design.md`
maps to a green test (P1→INV-07, P2→INV-08, P3→protocol events tests,
P4→region e2e, P5→regtest HTLC e2e, P6→attestation/announcement tests).

Verified with:

- `deno task test:all` (each child closed against its own full-gate run)

Harness update:

- None — this issue owns no code change; the children carry the locks.

Review residuals:

- None

Follow-up:

- None

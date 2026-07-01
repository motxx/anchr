# Add a RandomSource port and remove node:crypto from requests/domain

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`requests/domain/challenge.ts` imports `randomBytes` from `node:crypto`, and
the "portable leaf" `requests/domain/ports.ts` pulls it in transitively — so
importing the supposedly browser-portable domain ports loads a Node builtin.
The arch-lint leaf exemption stops traversal at `ports.ts` and hides this.
Randomness is also the one side-effect with no injected port (unlike time,
config, persistence, execution), and the same file uses Web Crypto elsewhere,
so there are two inconsistent randomness implementations.

## Rationale

- `packages/sdk/src/requests/domain/challenge.ts` (~lines 1, 13) imports
  `node:crypto`; imported by `ports.ts` (~lines 61-66).
- `ports.ts` is in arch-lint `PORTABLE_GRAPH_LEAF_TARGETS`, so E031 stops there
  and never sees the Node import.
- `createDefaultIdGenerator` uses Web Crypto `getRandomValues` for the same
  need.

## Acceptance

- A `RandomSource` port (or Web Crypto) replaces the `node:crypto` import in
  `challenge.ts`; the domain ports graph no longer loads a Node builtin.
- The arch-lint leaf exemption for `ports.ts` is removed so the graph is
  actually traversed.

## Verification

- `rg "node:crypto" packages/sdk/src/requests` returns no matches.
- `deno task lint:strict` passes with the leaf exemption removed.

## Plan

- Define/inject a `RandomSource` (or use Web Crypto) in `challenge.ts`.
- Drop the `ports.ts` leaf exemption in `scripts/arch-lint.ts`.

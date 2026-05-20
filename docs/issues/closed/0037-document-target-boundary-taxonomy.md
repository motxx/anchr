# Document target boundary taxonomy

Created: 2026-05-20
Model: GPT-5
Completed: 2026-05-20

## Priority

design

## Dependencies

Depends on:
- 0036

Blocks:
- 0038
- 0039
- 0040
- 0041
- 0042
- 0043

## Summary

Define the target directory and package-boundary taxonomy before moving files.
The current implementation already has useful conceptual boundaries
(`protocol`, actor SDKs, proof engines, settlement primitives, adapters, and
apps/examples), but those boundaries are not yet expressed consistently in the
physical tree or public package map.

This issue should turn the package-boundary review into an accepted target
layout and migration order.

## Rationale

Relevant references:

- `docs/architecture.md`
- `docs/issues/pending/0036-rationalize-package-boundaries.md`
- `CLAUDE.md`
- `packages/*/deno.json`
- `scripts/arch-lint.ts`

The working taxonomy from the boundary review is:

- `packages/protocol` for wire formats, schema identifiers, event builders, and
  role-neutral types.
- `packages/sdk/*` for Customer, Provider, Oracle, and aggregate SDK surfaces.
- `packages/adapters/*` for Nostr, Cashu, Blossom, state, HTTP Oracle, and
  other concrete technology bindings.
- `packages/proofs/*` for TLSNotary and photo/C2PA/ProofMode verification
  engines.
- `packages/settlement/*` for Cashu HTLC, conditional swaps, and FROST/P2PK
  release primitives.
- `packages/runtime` for cross-runtime helpers.
- `packages/flows/*` for reusable but product-shaped workflows such as bounty
  or claim-gate.
- `apps/` for maintained runnable product surfaces.
- `examples/` for demos, sketches, and integration fixtures.

## Plan

- Write the accepted target tree and package roles into `docs/architecture.md`.
- Decide whether public package names change immediately or whether physical
  moves happen behind existing exports first.
- Mark which current packages are stable public surfaces, transitional facades,
  reusable primitives, or app-owned code.
- Record a migration order that avoids breaking imports before replacement
  exports exist.
- Update issue dependencies if the accepted taxonomy changes the follow-up
  sequence.

## Resolution

Implemented by updating:

- `docs/architecture.md`

Verified with:

- `deno task lint:fmt`

Harness update:

- None — this is an architecture-boundary decision now recorded in
  `docs/architecture.md`; deterministic enforcement is tracked by #0043.

Review residuals:

- Maintainer must choose final public package names before implementation
  issues rewrite imports. The directory ownership decision is recorded here;
  naming can be settled inside the relevant follow-up issue.

Follow-up:

- #0038
- #0039
- #0040
- #0041
- #0042
- #0043

# Align settlement layout

Created: 2026-05-21
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0043

## Summary

Settle settlement primitive package names and ownership so a reader can tell
what each settlement package can do independently. The result must not look like
the old tree was merely flattened.

## Rationale

Parent issue: #0043.

The target taxonomy lists `packages/settlement/cashu-htlc`,
`packages/settlement/conditional-swap`, and
`packages/settlement/frost-oracle`. The current tree still uses
`packages/core-cashu`, `packages/cashu-conditional-swap`, and
`packages/frost-oracle`.

The confusing part is not only physical placement. `core-cashu` does not say
whether it is a wallet helper, an escrow construction, the canonical Cashu
settlement primitive, or just a dependency root. `frost-oracle` also reads like
an actor-level Oracle package even though it is a threshold-signing settlement
primitive.

Relevant files:

- `docs/architecture.md`
- `packages/core-cashu/`
- `packages/cashu-conditional-swap/`
- `packages/frost-oracle/`
- `packages/adapters/src/cashu.ts`
- `packages/bounty/src/infrastructure/escrow/`
- `apps/two-party-binary-bet/`
- `e2e/`
- `scripts/arch-lint.ts`

## Plan

- Decide whether settlement primitives keep flat package directories or are
  renamed to capability-revealing flat package names.
- Decide whether `core-cashu` should be renamed or explicitly documented as the
  canonical Cashu HTLC/P2PK settlement package. Do not leave `core-*` unexplained.
- Decide whether `frost-oracle` should stay named as-is or be renamed/documented
  as threshold release/signing infrastructure rather than the actor Oracle SDK.
- Update README/SPEC/package-map text so each settlement package says what an
  integrator can use without the rest of Anchr.
- If renaming or moving, rewrite imports, workspace entries, package manifests,
  README/SPEC links, Docker/build references, and lint allow-lists in one
  coordinated change.
- Preserve the canonical Cashu and FROST semantics from #0039 and #0040.
- Verify with settlement package tests, affected app/example tests,
  `deno task lint:strict`, and the relevant e2e smoke checks.

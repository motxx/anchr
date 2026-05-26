# Rationalize package boundaries

Created: 2026-05-16
Model: GPT-5
Completed: 2026-05-20

## Priority

design

## Dependencies

Depends on:
- 0035

Blocks:
- 0037
- 0038
- 0039
- 0040
- 0041
- 0042
- 0043

## Summary

Review the `packages/` layout against the clarified repository purpose and
decide which packages are core Anchr deliverables, which are reusable
technology primitives, which are reference adapters, and which should be moved,
merged, renamed, or documented as transitional.

The current package granularity is hard to evaluate because purpose and
ownership are mixed. Some packages are actor SDKs, some are protocol helpers,
some are proof or storage toolkits, and some are broader brand-neutral
experiments. Once issue 0035 clarifies the repository goal, this issue should
turn that goal into concrete package-boundary decisions.

## Rationale

Relevant references:

- `packages/`
- `packages/sdk/README.md`
- `packages/customer-sdk/README.md`
- `packages/provider-sdk/README.md`
- `packages/oracle-sdk/README.md`
- `packages/protocol/README.md`
- `packages/core-cashu/README.md`
- `packages/tlsn-toolkit/README.md`
- `packages/photo-verification/README.md`
- `packages/frost-oracle/README.md`
- `packages/cashu-conditional-swap/README.md`
- `packages/blossom/README.md`
- `packages/bounty/deno.json`
- `docs/architecture.md`
- `scripts/arch-lint.ts`

Examples of boundary questions to settle:

- whether `@anchr/sdk`, `@anchr/customer-sdk`, `@anchr/provider-sdk`, and
  `@anchr/oracle-sdk` are stable public surfaces or transitional split points;
- whether brand-neutral primitives such as `frost-oracle` and
  `cashu-conditional-swap` belong under the same Anchr package namespace;
- whether verification toolkits such as `tlsn-toolkit` and
  `photo-verification` are core dependencies, optional adapters, or examples;
- whether `packages/bounty` still names the current domain accurately;
- whether architecture lint dependency rules match the intended package layers.

## Plan

- Wait for issue 0035 to define the repository purpose and top-level package
  taxonomy.
- Inventory every package with its public API, dependency direction, runtime
  assumptions, publication status, and intended audience.
- Propose a target package taxonomy: core actor SDKs, protocol/spec helpers,
  reference adapters, reusable primitives, and transitional or example-only
  code.
- Convert the taxonomy into a concrete migration plan: keep, merge, rename,
  move under `example/`, split, or document as intentionally external-facing.
- Update `docs/architecture.md`, package READMEs, and `scripts/arch-lint.ts`
  rules to match the chosen boundaries.

## Resolution

Implemented by updating:

- `docs/architecture.md`
- `docs/issues/pending/0037-document-target-boundary-taxonomy.md`
- `docs/issues/pending/0038-extract-shared-sdk-adapters.md`
- `docs/issues/pending/0039-canonicalize-cashu-settlement-primitives.md`
- `docs/issues/pending/0040-introduce-threshold-signing-port.md`
- `docs/issues/pending/0041-split-bounty-flow-and-adapters.md`
- `docs/issues/pending/0042-separate-apps-and-examples.md`
- `docs/issues/pending/0043-update-boundary-lints-and-docs.md`

Verified with:

- `deno task lint:fmt`

Harness update:

- None — this issue records the boundary review decision in
  `docs/architecture.md`; enforcement and config updates are tracked by #0043.

Review residuals:

- None

Follow-up:

- #0037
- #0038
- #0039
- #0040
- #0041
- #0042
- #0043

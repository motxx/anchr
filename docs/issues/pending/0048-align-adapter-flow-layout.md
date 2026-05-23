# Align adapter flow layout

Created: 2026-05-21
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0038
- 0041

Blocks:
- 0043

## Summary

Align adapter and flow package names, ownership, and reusable capabilities with
the target taxonomy, including the remaining transitional `bounty` and
`claim-gate` surfaces.

## Rationale

Parent issue: #0043.

#0038 introduced a flat `packages/adapters` package, and #0041 narrowed
`packages/bounty` into explicit subpath exports. The target taxonomy still
describes `packages/adapters/*` and `packages/flows/*`, while the physical tree
keeps `packages/adapters`, `packages/blossom`, and `packages/bounty` at the
top level.

The package map must answer what is independently reusable: for example,
whether `adapters` means standard Nostr/Cashu/state adapters, whether `blossom`
is an attachment transport package or just an adapter detail, and whether
`bounty` is a reusable flow or only legacy migration scaffolding.

Relevant files:

- `docs/architecture.md`
- `packages/adapters/`
- `packages/blossom/`
- `packages/bounty/`
- `apps/anchr-mcp/`
- `apps/data-marketplace/`
- `apps/airdrop-bot-shield/`
- `scripts/arch-lint.ts`
- `scripts/arch-lint-candidates.ts`

## Plan

- Decide whether adapters and flows keep flat package directories or are renamed
  to capability-revealing flat package names.
- Make the package map say which adapter/flow packages can be used separately
  from the aggregate SDK.
- If renaming or moving, update imports, workspace entries, package manifests,
  docs, examples/apps, and lint rules in one coordinated change.
- Decide whether `claim-gate` remains a bounty subpath or becomes its own flow
  package.
- Verify with adapter tests, affected app tests, `deno task test:examples`, and
  `deno task lint:strict`.

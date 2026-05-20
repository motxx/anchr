# Update boundary lints and docs

Created: 2026-05-20
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0038
- 0039
- 0040
- 0041
- 0042

Blocks:
- None

## Summary

Update architecture lint rules, workspace configuration, package READMEs, and
developer documentation after the directory and boundary redesign lands.

## Rationale

Relevant references:

- `scripts/arch-lint.ts`
- `scripts/arch-lint-candidates.ts`
- `deno.json`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/architecture.md`
- `packages/*/README.md`
- `packages/*/deno.json`

The current deterministic lint allow-list encodes today's package graph:
primitive packages, actor SDKs, `bounty`, and examples. Once adapter, proof,
settlement, flow, apps, and examples boundaries move, the lint should become
the enforcement mechanism for the new architecture instead of preserving the
old one.

## Plan

- Update package dependency allow-lists to match the accepted taxonomy.
- Add or adjust rules so actor SDKs depend on ports and protocol, while concrete
  technology bindings live in adapter/proof/settlement packages.
- Update workspace entries, import maps, publish manifests, and README install
  examples.
- Update `CLAUDE.md`, `AGENTS.md`, and `docs/architecture.md` with the new
  directory map.
- Run the relevant lint, unit, example, and E2E smoke commands documented by
  the migration issues.

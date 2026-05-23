# Enforce minimal surface

Created: 2026-05-21
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0047
- 0049

Blocks:
- 0043

## Summary

Make repository tooling and documentation enforce the Unix-philosophy surface
after #0047 and #0049. The final repository map should show only the SDK,
protocol, specs, docs, scripts needed to build/test/publish, curated examples,
native helper crates when required, and e2e tests. This is the final cleanup
issue, not the package-collapse or app-pruning implementation issue.

## Rationale

The final state should prevent drift back into a multi-product repository. A new
reader should not see public packages, apps, tools, or example domains that make
Anchr look like a marketplace, bounty board, bot platform, mobile app, binary
bet system, royalty tool, or supply-chain product.

Every public Anchr import should come from:

- `@anchr/sdk`
- `@anchr/protocol`

There should be no `apps/` directory and no `tools/` escape hatch. `bounty`
should appear only in historical issue text or in a deliberately tiny example
approved by #0049.

Relevant files:

- `README.md`
- `docs/architecture.md`
- `docs/example-delivery-lifecycle.md`
- `CLAUDE.md`
- `AGENTS.md`
- `deno.json`
- `scripts/arch-lint.ts`
- `scripts/arch-lint-candidates.ts`
- `scripts/check-no-local-paths.ts`
- `scripts/lint-dockerfile-workspace.ts`
- `packages/sdk/README.md`
- `packages/protocol/README.md`
- `examples/`
- `e2e/`

## Acceptance

- `deno.json` workspace, import map, and publish dry-run task list only
  `packages/sdk`, `packages/protocol`, and curated examples that remain after
  #0049.
- Architecture lint enforces the minimal dependency surface: protocol has no
  Anchr package dependencies, SDK may depend on protocol, examples/tests use
  only `@anchr/sdk` or `@anchr/protocol`.
- README, architecture docs, package READMEs, and agent docs present Anchr as an
  SDK/protocol for verifiable paid requests.
- No non-historical docs or tooling references advertise deleted package names,
  `apps/`, `tools/`, or bounty as a core surface.

## Verification

- `deno task lint:strict`
- `deno task test`
- `deno task publish:dry-run`
- No non-historical matches are expected:
  `rg -n "apps/|tools/|@anchr/bounty|@anchr/sdk/bounty|@anchr/(customer-sdk|provider-sdk|oracle-sdk|core-runtime|core-cashu|frost-oracle|tlsn-toolkit|photo-verification|cashu-conditional-swap|blossom|adapters)" README.md docs packages examples e2e deno.json scripts`

## Plan

- Reduce the Deno workspace, import map, and publish dry-run task to
  `packages/sdk`, `packages/protocol`, and curated examples that remain after
  #0049.
- Replace package dependency allow-lists with minimal rules: `protocol` depends
  on no other `@anchr/*` package; `sdk` may depend on `protocol`; examples and
  tests use only `@anchr/sdk` or `@anchr/protocol` for Anchr code.
- Update docs so first-visit guidance is: use `@anchr/sdk`; use
  `@anchr/protocol` only for wire compatibility or alternate implementations.
- Remove stale references to deleted package names, `apps/`, `tools/`, and
  non-core product surfaces unless the reference is historical closed-issue
  text.
- Do not reopen product/API classification from #0046, package movement from
  #0047, or app/example pruning from #0049 except to file a focused follow-up
  issue for a concrete blocker.
- Verify with `deno task lint:strict`, `deno task test`, affected e2e smoke
  commands, and `deno task publish:dry-run`.

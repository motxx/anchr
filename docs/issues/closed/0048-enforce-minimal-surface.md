# Enforce minimal surface

Created: 2026-05-21
Model: GPT-5
Completed: 2026-05-24

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0047
- 0049
- 0066

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

## Resolution

Implemented by updating:

- `deno.json`
- `packages/sdk/deno.json`
- `scripts/arch-lint.ts`
- `scripts/arch-lint-candidates.ts`
- `README.md`
- `docs/architecture.md`
- `docs/resilience-checklist.md`
- `packages/sdk/README.md`
- `packages/protocol/README.md`
- `packages/sdk/src/testing/mod.ts`
- `packages/sdk/src/adapters/nostr/index.ts`
- `packages/sdk/src/adapters/oracle-client/index.ts`
- `packages/sdk/src/proofs/verification/verifier.ts`
- `packages/sdk/src/requests/testing/protocol-helpers.ts`
- `e2e/protocol/*.test.ts`
- `e2e/regtest/core-flow.test.ts`
- `e2e/regtest/regtest-cashu.test.ts`
- `e2e/tlsn/tlsn.test.ts`
- `scripts/frost-dkg-bootstrap.ts`

Removed obsolete product/demo surfaces:

- `e2e/relay/relay.test.ts`
- `scripts/create-bounty-query.ts`
- `scripts/demo-htlc-server.ts`
- `scripts/demo-htlc.ts`
- `scripts/demo-payment-proof.html`
- `scripts/demo-payment-proof.ts`
- `scripts/e2e-browser-qa.ts`
- `scripts/e2e-flow-ui.html`
- `scripts/e2e-square-full.ts`
- `scripts/e2e-square-payment-link.ts`
- `scripts/e2e-stripe-full.ts`
- `scripts/e2e-stripe-payment-link.ts`
- `scripts/frost-oracle-cluster.ts`
- `scripts/run-square-proof.ts`
- `scripts/run-stripe-proof.ts`

Verified with:

- `deno task lint:arch`
- `deno task check`
- `deno task test:scripts`
- `deno task lint:strict`
- `deno task test`
- `deno task publish:dry-run`

Harness update:

- `scripts/arch-lint.ts` now enforces the final SDK/protocol dependency graph
  and requires examples, e2e tests, and scripts to use only public
  `@anchr/sdk` or `@anchr/protocol` Anchr imports.

Review residuals:

- `deno task test:e2e:relay` still requires relay infrastructure and failed
  locally because `NOSTR_RELAYS` was not set. The remaining relay-backed
  oracle discovery test is covered when that Docker-backed task is run with its
  required infrastructure.
- #0064 remains as the post-#0048 Blossom attachment boundary audit.

Follow-up:

- #0064

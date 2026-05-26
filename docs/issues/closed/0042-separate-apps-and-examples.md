# Separate apps and examples

Created: 2026-05-20
Model: GPT-5
Completed: 2026-05-20

## Priority

maintenance

## Dependencies

Depends on:
- 0037

Blocks:
- 0043

## Summary

Split the current `example/` tree into maintained runnable applications and
small examples/sketches. The existing directory mixes MCP adapters, Hono
servers, Expo apps, hosted testnet demos, testnet scripts, and concept
simulations.

## Rationale

Relevant references:

- `example/anchr-mcp/`
- `example/data-marketplace/`
- `example/bounty-board/`
- `example/expo-worker-app/`
- `example/two-party-binary-bet/`
- `example/airdrop-bot-shield/`
- `example/tlsn-fiat-swap-square/`
- `example/c2pa-media-verification/`
- `example/auto-claim/`
- `example/supply-chain-proof/`
- `example/royalty-distribution/`
- `CLAUDE.md`
- `docs/architecture.md`

`apps/` should hold maintained product or adapter surfaces with their own
runtime, configuration, and operational policy. `examples/` should hold small
integration demos, concept sketches, and fixtures that teach a pattern without
pretending to be an application.

## Plan

- Classify every current `example/<name>` directory as app, example, concept
  sketch, or deletion candidate.
- Move maintained runnable surfaces to `apps/` and demos/sketches to
  `examples/`.
- Update root `deno.json`, per-app configs, scripts, docs, and architecture
  lint path rules.
- Remove or close empty reference-host/reference-app leftovers if confirmed
  unused.
- Keep `example/` compatibility only if the accepted migration plan requires a
  temporary path.

## Resolution

Implemented by updating:

- `apps/`
- `examples/`
- `.gitignore`
- `deno.json`
- `Dockerfile`
- `scripts/arch-lint.ts`
- `scripts/build-css.ts`
- `scripts/build-ui.ts`
- `scripts/bot-fleet/`
- `docs/architecture.md`
- `docs/example-delivery-lifecycle.md`
- `docs/review-harness.md`
- `docs/universality-boundaries.md`
- `e2e/`
- `fly.market.toml`
- `README.md`

Verified with:

- `deno task test:examples`
- `deno task lint:strict`
- `deno task test:scripts`
- `deno check e2e/relay/two-party-binary-bet-nostr.test.ts e2e/regtest/nip60-user-flow.test.ts e2e/regtest/redemption-flow.test.ts e2e/regtest/nip61-nutzap.test.ts e2e/regtest/two-party-binary-bet-lifecycle.test.ts e2e/regtest/nip60-wallet.test.ts e2e/regtest/conditional-swap.test.ts e2e/regtest/bot-fleet.test.ts e2e/regtest/fiat-swap-square.test.ts`

Harness update:

- `scripts/arch-lint.ts` now scans both `apps/` and `examples/`, and the
  Dockerfile workspace lint keeps workspace-member COPY paths aligned with
  `deno.json`.

Review residuals:

- Tracked `example/anchr-reference-host` and `example/reference-app` files were
  already absent, so no compatibility tree was kept.

Follow-up:

- 0043

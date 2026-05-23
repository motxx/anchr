# Prune noncore surfaces

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-23

## Priority

design

## Dependencies

Depends on:
- 0046

Blocks:
- 0043
- 0048

## Summary

Remove repository surfaces that make Anchr look like it does more than
verifiable paid requests. Delete `apps/` as a category, do not introduce
`tools/`, and keep only tiny examples that directly teach `@anchr/sdk` or
`@anchr/protocol`. This issue owns apps/examples only; package collapse belongs
to #0047 and final lint/docs enforcement belongs to #0048.

## Rationale

Unix philosophy rewards small composable tools with clear interfaces. For this
repository, that means examples should demonstrate the SDK/protocol; they should
not become product surfaces. A large example is not solved by moving it to
`apps/` or `tools/`. That just creates another category users must understand.

Hard rules:

- Keep a surface in `examples/` only if it teaches one SDK/protocol lesson for
  verifiable paid requests.
- Delete it, or move it outside this repository, if it is a product surface,
  operational adapter, mobile app, marketplace, bot shield, binary bet, royalty
  domain exploration, supply-chain domain exploration, or other non-core app.
- Do not create `tools/`.
- Developer-only scripts may remain under existing `scripts/` only when they
  are required to build, test, lint, publish, or verify SDK/protocol behavior.

Relevant current surfaces:

- `apps/anchr-mcp/`
- `apps/data-marketplace/`
- `apps/airdrop-bot-shield/`
- `apps/two-party-binary-bet/`
- `apps/bounty-board/`
- `apps/expo-worker-app/`
- `examples/c2pa-media-verification/`
- `examples/tlsn-fiat-swap-square/`
- `examples/auto-claim/`
- `examples/royalty-distribution/`
- `examples/supply-chain-proof/`
- `examples/tlsn-worker/`

## Acceptance

- The repository has no `apps/` directory.
- The repository has no `tools/` directory created as a replacement category.
- Every remaining `examples/<name>/` entry teaches one SDK/protocol lesson for
  verifiable paid requests and imports only `@anchr/sdk` or `@anchr/protocol`
  for Anchr code.
- Non-core product shells, marketplaces, bots, mobile apps, operational
  adapters, bounty boards, binary-bet flows, royalty explorations, and
  supply-chain explorations are deleted or moved outside this repository.
- README and docs describe examples as optional learning material, not required
  infrastructure.

## Verification

- `test ! -d apps`
- `test ! -d tools`
- No matches are expected in remaining examples:
  `rg -n "@anchr/(customer-sdk|provider-sdk|oracle-sdk|core-runtime|core-cashu|frost-oracle|tlsn-toolkit|photo-verification|cashu-conditional-swap|blossom|adapters|bounty)" examples`
- `deno task test:examples`

## Plan

- Classify every app/example against #0046's one-thing statement.
- Delete `apps/` as a top-level repository category.
- Shrink any retained surface into `examples/<name>/` only if it is a small
  optional lesson importing only `@anchr/sdk` or `@anchr/protocol`.
- Delete or move out surfaces that are product shells, marketplaces, bots,
  mobile apps, operational adapters, bounty boards, binary-bet flows, or
  non-core domain explorations.
- Do not alter package boundaries except where an app/example import must be
  removed because the surface is deleted or shrunk.
- Enforce a strict example shape: one lesson, no production app shell, no
  deployment surface, no persistent service, no extra public Anchr packages,
  README plus smoke/test command when runnable.
- Update README and docs so examples are clearly optional learning material,
  never required infrastructure.

## Resolution

Implemented by updating:

- `apps/`
- `tools/`
- `examples/`
- `e2e/relay/`
- `e2e/regtest/`
- `scripts/bot-fleet/`
- `scripts/build-css.ts`
- `scripts/build-ui.ts`
- `deno.json`
- `Dockerfile`
- `README.md`
- `docs/architecture.md`
- `docs/example-delivery-lifecycle.md`
- `docs/universality-boundaries.md`
- `docs/http-402-integrations.md`
- `docs/review-harness.md`
- `packages/photo-verification/SPEC.md`
- `scripts/lint-fmt.ts`
- `scripts/lint-fmt.test.ts`

Verified with:

- `test ! -d apps`
- `test ! -d tools`
- `rg -n "@anchr/(customer-sdk|provider-sdk|oracle-sdk|core-runtime|core-cashu|frost-oracle|tlsn-toolkit|photo-verification|cashu-conditional-swap|blossom|adapters|bounty)" examples` returned no matches
- `deno task test:examples`
- `deno task lint:strict`

Harness update:

- `examples/examples.test.ts` enforces that future example TypeScript imports
  only `@anchr/sdk` or `@anchr/protocol` for Anchr packages.

Review residuals:

- None

Follow-up:

- #0048 owns final minimal-surface lint, publish, README, and package README
  enforcement.

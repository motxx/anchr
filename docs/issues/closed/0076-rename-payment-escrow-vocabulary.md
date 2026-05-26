# Rename payment escrow vocabulary

Created: 2026-05-25
Model: GPT-5 Codex
Completed: 2026-05-25

## Priority

maintenance

## Dependencies

Depends on:
- 0072

Blocks:
- 0067

## Summary

Replace old requester/worker vocabulary in SDK payment and escrow helper
surfaces after the Cashu HTLC owner decision in #0072. This child owns Cashu
HTLC option names, escrow provider port implementations, wallet-store actor
test fixtures, redemption helper tests, and payment docs/comments.

## Rationale

Parent issue #0067 found active matches in payment files such as
`packages/sdk/src/payments/cashu-htlc-options.ts`,
`packages/sdk/src/payments/cashu-escrow.ts`,
`packages/sdk/src/payments/cashu-escrow-provider.ts`,
`packages/sdk/src/payments/frost-escrow-provider.ts`,
`packages/sdk/src/payments/redeem-htlc.test.ts`, and
`packages/sdk/src/payments/wallet-store.test.ts`.

#0072 may move or clarify Cashu ownership, so this vocabulary migration should
wait until the payment owner is settled to avoid renaming symbols in a location
that is about to be replaced.

## Acceptance

- Payment and escrow helper types, parameters, variables, messages, and tests
  use Customer/Provider terminology.
- The selected Cashu public surface from #0072 exposes Provider/Customer names.
- No direct or test-only payment helper surface keeps `requester` or `worker`
  actor names as the canonical spelling.
- Any remaining occurrence is documented as a non-actor platform term or a
  wire migration deferred to #0075.

## Verification

- No matches are expected in payment and escrow surfaces:
  `rg -n "requester|Requester|worker|Worker" packages/sdk/src/payments packages/sdk/src/adapters/cashu.ts packages/sdk/src/adapters/cashu-htlc-options.ts`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Wait for #0072 to close.
- Re-read the settled Cashu/payment owner and update payment symbols in that
  owner only.
- Update tests and error messages that lock payment actor semantics.

## Resolution

Implemented by updating:

- `packages/sdk/src/payments/cashu-htlc-options.ts`
- `packages/sdk/src/payments/cashu-escrow.ts`
- `packages/sdk/src/payments/cashu-escrow-provider.ts`
- `packages/sdk/src/payments/frost-escrow-provider.ts`
- `packages/sdk/src/payments/wallet-store-helpers.ts`
- `packages/sdk/src/payments/htlc-escrow.test.ts`
- `packages/sdk/src/payments/redeem-htlc.test.ts`
- `packages/sdk/src/payments/wallet-store.test.ts`
- `packages/sdk/src/payments/cashu-escrow-provider.test.ts`
- `packages/sdk/src/payments/frost-escrow-provider.test.ts`
- `packages/sdk/src/adapters/cashu.ts`
- `packages/sdk/src/adapters/cashu-htlc-options.ts`
- `e2e/protocol/bounty-trustless.test.ts`

Payment-owned HTLC, escrow, redemption, and wallet helper surfaces now use
Customer/Provider terminology. The Cashu lock verifier also fails closed for
malformed, non-HTLC, or missing-provider-lock proofs instead of treating those
paths as a successful lock verification.

Verified with:

- `rg -n "requester|Requester|worker|Worker" packages/sdk/src/payments packages/sdk/src/adapters/cashu.ts packages/sdk/src/adapters/cashu-htlc-options.ts`
- `deno task check`
- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys packages/sdk/src/payments/htlc-escrow.test.ts packages/sdk/src/payments/redeem-htlc.test.ts packages/sdk/src/payments/wallet-store.test.ts packages/sdk/src/payments/cashu-escrow-provider.test.ts packages/sdk/src/payments/frost-escrow-provider.test.ts`
- `deno task test:unit`
- `deno task lint:strict`
- `deno task test:all`
- `check-silent-bypass`: no silent-bypass patterns detected in the changed
  payment and Cashu adapter source files.

Harness update:

- `packages/sdk/src/payments/cashu-escrow-provider.test.ts` now locks the
  fail-closed Cashu `verifyLock` behavior for malformed, non-HTLC, missing
  pubkey tag, wrong hash, and wrong provider key paths.

Review residuals:

- None

Follow-up:

- None

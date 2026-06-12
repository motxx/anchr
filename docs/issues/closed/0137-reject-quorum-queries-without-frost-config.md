# Reject quorum queries when FROST is not configured

Created: 2026-06-12
Model: Claude Fable 5 (claude-fable-5)
Completed: 2026-06-13

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`packages/sdk/src/adapters/nostr/oracle-service.ts` silently downgrades a
query that demands quorum (threshold of independent oracle verifications) to
the single-oracle HTLC preimage path when `config.frostNodeConfig` is absent,
and still reports delivery success. The customer's requested trust model is
not honoured and nothing tells them.

## Rationale

- `oracle-service.ts`: `if (!config.frostNodeConfig) { log.error(...falling
  back to HTLC...); return verifyAndDeliverInternal(...); }` — and the quorum
  dispatch above it falls through without any log.
- Found by the `check-silent-bypass` full-file review (Pattern A) on
  2026-06-12. Pre-existing behavior.

## Acceptance

- A quorum query handled by an oracle without FROST configuration is rejected
  loudly (rejection DM or explicit failure result); no silent downgrade to
  single-oracle delivery.
- A test locks the rejection.

## Verification

- `deno task test:unit` or `deno task test:integration` with a test: quorum
  query + no FROST config → rejection, no preimage delivery.

## Plan

- Replace the fallback with an explicit rejection path when `query.quorum` is
  set and FROST is unavailable.

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/nostr/oracle-service.ts` — quorum queries are
  rejected loudly (rejection DM, `false` result) when FROST
  coordinator/config/node-config are missing; `verifyAndDeliverWithFrost`
  no longer falls back to the single-oracle HTLC path
- `packages/sdk/src/adapters/nostr/oracle-frost.test.ts` — tests lock the
  rejection DM for both the dispatch path and the FROST entry point, and
  assert the preimage is never revealed

Verified with:

- `deno task test:unit`

Harness update:

- `oracle-frost.test.ts` locks the no-silent-downgrade contract.

Review residuals:

- None

Follow-up:

- None

# Redesign public query advertisement

Created: 2026-06-01
Model: GPT-5 Codex
Completed: 2026-06-03

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0080
- 0098
- 0099

## Summary

Redesign the public kind `5300` request so it is an advertisement, not the
execution payload. This is a breaking pre-1.0 wire-shape change. Public relay
content should only include fields that are safe and useful for discovery.
Provider-specific execution and payment material should move to encrypted
selection content after Provider selection, or to another explicitly encrypted
flow.

## Rationale

Open discovery and default encryption are in tension: Providers cannot discover
jobs if everything is encrypted to unknown recipients, but public relays should
not receive sensitive execution context or payment-bearing material. The SDK
needs a canonical split before the README can present a copy-paste flow as the
normal way to use Anchr.

Relevant files:

- `packages/protocol/src/events.ts`
- `packages/protocol/src/events.test.ts`
- `packages/sdk/src/customer.ts`
- `packages/sdk/src/provider.ts`

## Acceptance

- The kind `5300` request shape is changed to a public advertisement with an
  explicit allowlist of public fields.
- Sensitive execution context and payment-bearing material must not appear in
  public request content.
- The Provider flow still supports public relay discovery without requiring an
  Anchr-operated registry or server.
- Tests lock the public request payload boundary.

## Verification

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- Unit test check: public request content contains only the advertisement
  allowlist, while execution and payment fields are absent from relay-visible
  content.
- Manual check: a Provider can still discover eligible work from public tags
  and public advertisement fields.

## Plan

- Decide the minimal public advertisement fields for open Provider discovery.
- Decide where encrypted execution and payment details travel after discovery.
- Update canonical protocol helpers, SDK orchestration, and focused tests for
  the chosen boundary.

## Resolution

Implemented by updating:

- `packages/protocol/src/events.ts`
- `packages/sdk/src/customer.ts`
- `packages/sdk/src/provider.ts`
- `packages/sdk/src/provider-types.ts`
- `packages/protocol/src/events.test.ts`
- `packages/sdk/src/customer.test.ts`
- `packages/sdk/src/provider.test.ts`
- `e2e/regtest/sdk-integration.test.ts`
- `CONTEXT.md`
- `specs/messaging.md`
- `specs/paid-request-exchange.md`
- `docs/adr/0002-split-public-request-advertisement.md`

Verified with:

- `deno task check`
- `deno test --allow-all packages/protocol/src/events.test.ts packages/sdk/src/provider.test.ts packages/sdk/src/customer.test.ts packages/sdk/src/integration.test.ts`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:arch`
- `deno fmt --check packages/protocol/src/events.ts packages/protocol/src/events.test.ts packages/sdk/src/customer.ts packages/sdk/src/customer.test.ts packages/sdk/src/provider.ts packages/sdk/src/provider-types.ts packages/sdk/src/provider.test.ts packages/sdk/src/integration.test.ts e2e/regtest/sdk-integration.test.ts CONTEXT.md specs/messaging.md specs/paid-request-exchange.md docs/adr/0002-split-public-request-advertisement.md`
- `deno task test:all`

Harness update:

- Added unit coverage for the kind `5300` public advertisement allowlist,
  rejection of public execution/payment fields, encrypted selection execution
  delivery, and Provider rejection when encrypted selection execution conflicts
  with the public advertisement.
- Added spec and ADR coverage for the public discovery versus Provider-only
  execution/payment boundary.
- Ran `check-silent-bypass` review on the changed package files; no
  silent-bypass patterns remained after adding the Provider-side selection
  consistency checks.

Review residuals:

- None.

Follow-up:

- `0102` still owns the broader SDK Nostr adapter boundary cleanup.

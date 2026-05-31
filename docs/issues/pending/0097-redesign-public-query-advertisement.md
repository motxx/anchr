# Redesign public query advertisement

Created: 2026-06-01
Model: GPT-5 Codex

## Priority

design

## Dependencies

Depends on:
- 0096

Blocks:
- 0098
- 0099

## Summary

Redesign the public kind `5300` request so it is an advertisement, not the
execution payload. Public relay content should only include fields that are
safe and useful for discovery. Provider-specific execution and payment material
should move to an encrypted handoff after Provider selection, or to another
explicitly encrypted flow.

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
- `specs/messaging.md`
- `README.md`

## Acceptance

- The stable kind `5300` request shape is documented as a public advertisement
  with an explicit allowlist of public fields.
- Sensitive execution context and payment-bearing material are not required in
  public request content.
- The Provider flow still supports public relay discovery without requiring an
  Anchr-operated registry or server.
- Tests lock the public request payload boundary.

## Verification

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- Manual check: `rg -n "bounty_token|mint_url" specs/messaging.md packages/protocol/src/events.ts` only finds encrypted execution or payment payload definitions, not public advertisement fields.
- Manual check: a Provider can still discover eligible work from public tags
  and public advertisement fields.

## Plan

- Decide the minimal public advertisement fields for open Provider discovery.
- Decide where encrypted execution and payment details travel after discovery.
- Update canonical protocol helpers, SDK orchestration, and focused tests for
  the chosen boundary.

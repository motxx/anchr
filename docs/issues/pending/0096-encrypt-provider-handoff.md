# Encrypt provider handoff

Created: 2026-06-01
Model: GPT-5 Codex

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- 0080
- 0097
- 0098
- 0099

## Summary

The selected Provider handoff must be encrypted by default. The Customer knows
the selected Provider pubkey when it publishes selection feedback, so the
handoff content should not remain public relay-readable JSON.

## Rationale

The canonical Nostr event helpers live in `packages/protocol/src/events.ts`.
They currently sign kind `7000` selection feedback with public JSON content,
while result, Oracle-readable result payloads, and preimage delivery already
use NIP-44 recipient encryption. Selection is the first unambiguous place where
the SDK has a concrete Provider recipient, so the default should be encrypted.

Relevant files:

- `packages/protocol/src/events.ts`
- `packages/protocol/src/events.test.ts`
- `packages/sdk/src/customer.ts`
- `packages/sdk/src/provider.ts`

## Acceptance

- Customer selection feedback encrypts Provider-only handoff content to the
  selected Provider by default.
- Provider-side parsing/decryption accepts the canonical encrypted handoff.
- Public selection event tags are explicitly limited to the request reference,
  selected Provider pubkey, and lifecycle status.
- Public selection event content and tags do not contain Provider-only handoff,
  payment, proof, credential, or execution material.
- Tests fail if Provider-only handoff content is serialized as public event
  content by the canonical builder.

## Verification

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- Unit test check: the canonical selection builder produces encrypted content
  for the selected Provider and no public event field serializes the handoff
  token.
- Manual check: inspect selection event tags and confirm only request
  reference, selected Provider pubkey, and lifecycle status remain public.

## Plan

- Re-read the canonical kind `7000` selection builder, parser, and SDK call
  sites.
- Change the handoff wire shape to recipient-encrypted content while keeping
  public tags usable for routing.
- Update focused protocol and SDK tests before broader documentation cleanup.

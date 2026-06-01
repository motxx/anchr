# Encrypt provider selection content

Created: 2026-06-01
Model: GPT-5 Codex
Completed: 2026-06-02

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

The selected Provider content must be encrypted by default. The Customer knows
the selected Provider pubkey when it publishes selection feedback, so the
Provider Redemption Token should not remain public relay-readable JSON.

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

- Customer selection feedback encrypts Provider-only content to the
  selected Provider by default.
- Provider-side parsing/decryption accepts the canonical encrypted selection
  content.
- Public selection event tags are explicitly limited to the request reference,
  selected Provider pubkey, and lifecycle status.
- Public selection event content and tags do not contain Provider-only payment,
  proof, credential, or execution material.
- Tests fail if Provider-only content is serialized as public event
  content by the canonical builder.

## Verification

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- Unit test check: the canonical selection builder produces encrypted content
  for the selected Provider and no public event field serializes the Provider
  Redemption Token.
- Manual check: inspect selection event tags and confirm only request
  reference, selected Provider pubkey, and lifecycle status remain public.

## Plan

- Re-read the canonical kind `7000` selection builder, parser, and SDK call
  sites.
- Change the Provider-only wire shape to recipient-encrypted content while
  keeping public tags usable for routing.
- Update focused protocol and SDK tests before broader documentation cleanup.

## Resolution

Implemented by updating:

- `CONTEXT.md`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/events.test.ts`
- `packages/sdk/src/customer.ts`
- `packages/sdk/src/customer.test.ts`
- `packages/sdk/src/provider.ts`
- `packages/sdk/src/provider.test.ts`
- `specs/messaging.md`

Verified with:

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:strict`

Harness update:

- `packages/protocol/src/events.test.ts` now verifies that selection content is
  NIP-44 encrypted to the selected Provider and rejects decryption with the
  wrong recipient key.
- `packages/sdk/src/customer.test.ts` now verifies the Provider Redemption Token
  is absent from public selection event content.
- `packages/sdk/src/provider.test.ts` exercises Provider-side decryption through
  the canonical selection parser.

Review residuals:

- Public request advertisement and remaining request privacy boundary work stay
  with #0097.
- Broader messaging privacy wording stays with #0098.
- Runnable Quick Start work stays with #0099.

Follow-up:

- #0097
- #0098
- #0099

# Align messaging privacy docs

Created: 2026-06-01
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0097

Blocks:
- 0080
- 0099

## Summary

Align `specs/messaging.md`, protocol conformance notes, and public README
language with the final default-encryption behavior. The docs should not
contradict themselves about whether request, selection, result, and release
payloads are public JSON or NIP-44 encrypted content.

## Rationale

`specs/messaging.md` currently describes public request JSON, but later text
still refers to encrypted selection content and sensitive context encrypted to
the Provider. The active code encrypts result and release messages, but the
request and selection privacy boundary is being corrected by #0096 and #0097.
Docs should describe the implemented default, not an aspirational or mixed
state.

Relevant files:

- `specs/messaging.md`
- `docs/protocol-conformance-audit.md`

## Acceptance

- `specs/messaging.md` has one consistent privacy model for each Nostr message
  class.
- Public docs state that relay-visible fields are public by design and that
  Provider-only selection content is encrypted by default.
- Protocol conformance notes name the test owner for each privacy boundary.
- README privacy edits are limited to references needed to avoid contradicting
  the messaging spec; the runnable Quick Start rewrite remains owned by #0099.

## Verification

- `deno task check`
- `deno task test:unit`
- Manual check: `rg -n "not encrypted|encrypted content includes|must not contain private|Plaintext payload" specs/messaging.md docs/protocol-conformance-audit.md` finds only wording that matches the final implemented privacy model.
- Manual check: request, offer, selection, result, Oracle payload, and release
  sections each state whether their content is public or encrypted.

## Plan

- Re-read the final event helpers after #0096 and #0097 land.
- Rewrite the messaging spec privacy sections to match code and tests.
- Trim README wording so it states the model without over-explaining it.
